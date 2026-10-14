// Conversation engine: onboarding → consent → daily voice logging with read-back confirmation →
// summaries, passport, EV estimate, sharing controls, data rights. Channel-agnostic.
import { readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { one, run } from './db.ts';
import { t, ASR_LANG, LANGS, isLang, type Lang } from './i18n.ts';
import { addDays, lagosDay, naira, nowIso, normalisePhone, uid, token } from './util.ts';
import { sha256, hashSecret } from './crypto.ts';
import * as U from './users.ts';
import type { User } from './users.ts';
import type { Inbound, OutMsg } from './channels/types.ts';
import { send } from './channels/send.ts';
import { downloadMedia } from './channels/whatsapp.ts';
import { transcribe, looksDegenerate, ModelError } from './models.ts';
import { extract } from './nlu/extract.ts';
import { extractAmounts } from './nlu/numbers.ts';
import { detectCommand, REPAYMENT_TYPES, EXPENSE_TYPES, type EntryType } from './nlu/keywords.ts';
import type { Draft } from './nlu/fallback.ts';
import { logInteraction, updateInteraction, setOutcome, seenExternal } from './interactions.ts';
import { appendEntries, liveEntries } from './ledger.ts';
import { checkDrafts } from './anomalies.ts';
import { requestAttestation, respondAttestation, pendingForOwner, linkOwner } from './attest.ts';
import { recordConsent, CONSENT_VERSION, decideGrant, revokeAll, newShareCode } from './grants.ts';
import { computeScore, dailyAggregates } from './scoring.ts';
import { issuePassport } from './passport.ts';
import { evEstimate } from './ev.ts';
import { answerQuestion, weeklyTip } from './coach.ts';
import { registerHandler, INBOUND_MAX_ATTEMPTS } from './jobs.ts';

type Ctx = { user: User; interactionId: string; source: 'voice' | 'text' | 'agent'; agentId?: string; isVoice: boolean };

const YES = new Set(['1', 'yes', 'y', 'ok', 'okay', 'correct', 'i agree', 'agree', 'i gree', 'gree', 'e correct', 'na yarda', 'e', 'eh', 'daidai ne',
  'mo gba', 'beeni', 'o tona', 'ekwere m', 'ee', 'o ziri ezi', 'allow', 'confirm']);
const NO = new Set(['2', 'no', 'n', 'not correct', 'wrong', 'e no correct', 'a a', 'aa', 'ba daidai ba', 'rara', 'ko tona', 'mba', 'o ziighi ezi', 'refuse']);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const yesNo = (s: string): boolean | null => (YES.has(norm(s)) ? true : NO.has(norm(s)) ? false : null);
const fresh = (id: string) => U.getUser(id)!;
const reply = (c: Ctx, msg: OutMsg) => send(c.user, msg);
const tr = (c: Ctx, key: string, vars?: Record<string, string | number>) => t(c.user.lang, key, vars);

const rateWindow = new Map<string, number[]>();
function rateLimited(userId: string): 'ok' | 'first' | 'silent' {
  const now = Date.now();
  const arr = (rateWindow.get(userId) ?? []).filter((x) => now - x < 5 * 60_000);
  arr.push(now);
  rateWindow.set(userId, arr);
  if (arr.length <= config.rateLimitPer5Min) return 'ok';
  return arr.length === config.rateLimitPer5Min + 1 ? 'first' : 'silent';
}

// ---------------------------------------------------------------- entry point (runs inside the job queue)
export async function handleInbound(m: Inbound, attempt = 1): Promise<void> {
  if (m.externalId && attempt === 1 && seenExternal(m.externalId)) return; // WhatsApp retries the same webhook
  const phone = normalisePhone(m.from);
  if (!phone) return;
  let user = U.findOrCreate(phone, m.channel);
  // Reply on the channel the person last used. This also covers someone who already exists as a vehicle
  // owner (WhatsApp, no rider consent yet) being onboarded as a rider through the web or a field agent.
  if (user.channel !== m.channel) U.update(user.id, { channel: m.channel });
  U.update(user.id, { last_inbound_at: nowIso() });
  user = fresh(user.id);

  const interactionId = m.externalId && attempt > 1 && seenExternal(m.externalId)
    ? (one('SELECT id FROM interactions WHERE external_id = ?', m.externalId)!.id as string)
    : logInteraction({ userId: user.id, channel: m.channel, direction: 'in', kind: m.kind, lang: user.lang, text: m.text ?? m.buttonId ?? null, externalId: m.externalId });

  const rl = rateLimited(user.id);
  if (rl !== 'ok') { if (rl === 'first') send(user, { text: t(user.lang, 'rate_limited') }); return; }

  const ctx: Ctx = { user, interactionId, source: m.agentId ? 'agent' : m.kind === 'audio' ? 'voice' : 'text', agentId: m.agentId, isVoice: m.kind === 'audio' };

  // Buttons that work in any state
  if (m.kind === 'button' && m.buttonId) {
    const [kind, id, ans] = m.buttonId.split(':');
    // Only the owner the confirmation was sent to may answer it (ignored for anyone else).
    if (kind === 'att') { respondAttestation(id, ans === 'y', 'whatsapp', user.id); return; }
    if (kind === 'grant') return grantDecision(ctx, id, ans === 'y');
  }
  // Owners replying 1/2 to a payment confirmation
  if (user.role === 'owner' && !user.consent_at) {
    const pend = pendingForOwner(user.id);
    const yn = yesNo(m.text ?? '');
    if (pend.length && yn !== null) { respondAttestation(pend[0].id, yn, 'whatsapp', user.id); return; }
    if (pend.length) { reply(ctx, { text: t(user.lang, 'owner_reply_hint') }); return; }
  }

  let text = m.text ?? '';
  if (m.kind === 'audio') {
    if (isOnboarding(user.state) && user.state !== 'await_name' && user.state !== 'await_remit' && user.state !== 'await_owner_phone') {
      // Choice steps (language, consent, vehicle, ownership, research) need a tap: consent must be explicit.
      // Say so, then re-ask the question with its buttons, instead of silently repeating it.
      if (user.state !== 'new' && user.state !== 'declined' && user.state !== 'erased') reply(ctx, { text: tr(ctx, 'tap_button') });
      return continueOnboarding(ctx, '');
    }
    const heard = await hear(ctx, m, attempt);
    if (heard === null) return;
    text = heard;
  } else if (m.kind === 'button') text = m.buttonId ?? m.text ?? '';

  await route(ctx, text);
}

async function hear(ctx: Ctx, m: Inbound, attempt: number): Promise<string | null> {
  let audio: Buffer, mime = m.mime ?? 'audio/ogg';
  try {
    if (config.modelMode === 'mock' && m.mockTranscript) audio = Buffer.alloc(0);
    else if (m.waMediaId) ({ data: audio, mime } = await downloadMedia(m.waMediaId));
    else if (m.audioPath) audio = readFileSync(m.audioPath);
    else throw new ModelError('no audio', 'bad_audio');
    if (audio.length > config.maxAudioBytes) throw new ModelError('too large', 'too_long');
    if (attempt === 1) reply(ctx, { text: tr(ctx, 'processing') });
    const r = await transcribe(audio, mime, ASR_LANG[ctx.user.lang], m.mockTranscript);
    updateInteraction(ctx.interactionId, { transcript: r.text, asrMs: r.ms, asrModel: r.model, audioSeconds: r.seconds, lang: ctx.user.lang });
    if (ctx.user.voice_research_opt_in && config.retainAudioForBenchmark && audio.length) saveForBenchmark(ctx, audio, mime, r.text);
    if (m.audioPath && existsSync(m.audioPath)) unlinkSync(m.audioPath);
    if (!r.text.trim() || looksDegenerate(r.text)) { reply(ctx, { text: tr(ctx, 'asr_failed') }); return null; }
    return r.text;
  } catch (e) {
    const kind = (e as any)?.kind ?? ((e as any)?.tooLarge ? 'too_long' : 'unavailable');
    const done = (key: string) => { reply(ctx, { text: tr(ctx, key) }); if (m.audioPath && existsSync(m.audioPath)) unlinkSync(m.audioPath); return null; };
    if (kind === 'too_long') return done('too_long');
    if (kind === 'bad_audio') return done('asr_failed');
    if (attempt >= INBOUND_MAX_ATTEMPTS) return done('asr_failed');
    if (attempt === 2) reply(ctx, { text: tr(ctx, 'delayed') }); // tell the rider once; the note is safe in the queue
    throw e; // retried by the job queue with back-off (GPU restarting / pod stopped)
  }
}

function saveForBenchmark(ctx: Ctx, audio: Buffer, mime: string, transcript: string): void {
  const dir = join(config.dataDir, 'benchmark', ASR_LANG[ctx.user.lang]);
  mkdirSync(dir, { recursive: true });
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') || mime.includes('aac') ? 'm4a' : 'ogg';
  const file = `${ctx.interactionId}.${ext}`;           // no name or phone attached
  writeFileSync(join(dir, file), audio);
  const manifest = join(dir, 'pending_labels.csv');
  if (!existsSync(manifest)) writeFileSync(manifest, 'file,asr_hypothesis,reference\n');
  writeFileSync(manifest, `${file},"${transcript.replace(/"/g, '""')}",\n`, { flag: 'a' });
}

// ---------------------------------------------------------------- routing
async function route(ctx: Ctx, text: string): Promise<void> {
  const u = ctx.user;
  if (u.status === 'waitlist') return reply(ctx, { text: tr(ctx, 'waitlist') });
  if (isOnboarding(u.state)) return continueOnboarding(ctx, text);

  const cmd = detectCommand(text);
  if (cmd && u.state !== 'await_pin') { updateInteraction(ctx.interactionId, { intent: cmd, modelPath: 'keyword' }); return command(ctx, cmd); }

  switch (u.state) {
    case 'await_confirm': {
      const yn = yesNo(text) ?? (text === 'cf:y' ? true : text === 'cf:n' ? false : null);
      if (yn === true) return commitDraft(ctx);
      if (yn === false) {
        const d = U.stateData(u);
        if (d?.interactionId) setOutcome(d.interactionId, 'corrected');
        U.setState(u.id, 'active');
        return reply(ctx, { text: tr(ctx, 'redo') });
      }
      // anything else: treat as a fresh log that replaces the draft
      const d = U.stateData(u);
      if (d?.interactionId) setOutcome(d.interactionId, 'corrected');
      return logMoney(ctx, text);
    }
    case 'await_delete': {
      if (text === 'del:y' || yesNo(text) === true) {
        reply(ctx, { text: tr(ctx, 'deleted') }); // queued with the phone number before erasure
        U.eraseUser(u.id);
        return;
      }
      U.setState(u.id, 'active');
      return reply(ctx, { text: tr(ctx, 'kept') });
    }
    case 'await_rating': {
      const n = Number(text.trim());
      U.setState(u.id, 'active');
      if (n >= 1 && n <= 5) {
        run('INSERT INTO feedback (id, user_id, rating, created_at) VALUES (?,?,?,?)', uid(), u.id, n, nowIso());
        U.update(u.id, { rated: 1 });
        return reply(ctx, { text: tr(ctx, 'rated') });
      }
      return logMoney(ctx, text);
    }
    case 'await_ev_lead': {
      U.setState(u.id, 'active');
      if (text.trim() === '1' || yesNo(text) === true) {
        const est = evEstimate(u.id, u.vehicle);
        run('INSERT INTO ev_leads (id, user_id, estimate, created_at) VALUES (?,?,?,?)', uid(), u.id, JSON.stringify(est), nowIso());
        return reply(ctx, { text: tr(ctx, 'ev_lead') });
      }
      return logMoney(ctx, text);
    }
    case 'await_pin': {
      U.setState(u.id, 'active');
      if (/^\d{4,6}$/.test(text.trim())) {
        U.update(u.id, { pin_hash: hashSecret(text.trim()) });
        return reply(ctx, { text: tr(ctx, 'pin_set', { link: `${config.publicBaseUrl}/rider` }) });
      }
      return reply(ctx, { text: tr(ctx, 'ask_pin') });
    }
    case 'await_grant': {
      const d = U.stateData(u);
      const yn = yesNo(text);
      if (d?.grantId && yn !== null) return grantDecision(ctx, d.grantId, yn);
      U.setState(u.id, 'active');
      return logMoney(ctx, text);
    }
    default:
      return logMoney(ctx, text);
  }
}

const ONBOARDING = ['new', 'declined', 'erased', 'await_lang', 'await_consent', 'await_name', 'await_vehicle', 'await_ownership', 'await_owner_phone', 'await_remit', 'await_research'];
const isOnboarding = (s: string) => ONBOARDING.includes(s);

// ---------------------------------------------------------------- onboarding
function langMenu(): OutMsg {
  return { text: t('en', 'choose_lang'), buttons: [
    { id: 'lang:en', title: 'English' }, { id: 'lang:pcm', title: 'Pidgin' }, { id: 'lang:ha', title: 'Hausa' },
    { id: 'lang:yo', title: 'Yorùbá' }, { id: 'lang:ig', title: 'Igbo' }] };
}

async function continueOnboarding(ctx: Ctx, text: string): Promise<void> {
  const u = ctx.user;
  const s = u.state;
  const n = norm(text);

  if (s === 'new' || s === 'declined' || s === 'erased') {
    if (u.role === 'rider' && U.activeUserCount() >= config.userCap) {
      U.update(u.id, { status: 'waitlist' });
      return reply(ctx, { text: tr(ctx, 'waitlist') });
    }
    U.setState(u.id, 'await_lang');
    return reply(ctx, langMenu());
  }
  if (s === 'await_lang') {
    const map: Record<string, Lang> = { '1': 'en', '2': 'pcm', '3': 'ha', '4': 'yo', '5': 'ig', english: 'en', pidgin: 'pcm', hausa: 'ha', yoruba: 'yo', igbo: 'ig' };
    const lang = text.startsWith('lang:') ? text.slice(5) : map[n];
    if (!lang || !isLang(lang)) return reply(ctx, langMenu());
    U.update(u.id, { lang });
    ctx.user = fresh(u.id);
    if (u.consent_at) { U.setState(u.id, 'active'); return reply(ctx, { text: tr(ctx, 'help') }); }
    U.setState(u.id, 'await_consent');
    return reply(ctx, { text: tr(ctx, 'consent'), audioKey: 'consent', buttons: [{ id: 'consent:y', title: tr(ctx, 'agree') }, { id: 'consent:n', title: tr(ctx, 'disagree') }] });
  }
  if (s === 'await_consent') {
    const yn = text === 'consent:y' ? true : text === 'consent:n' ? false : yesNo(text);
    if (yn === null) return reply(ctx, { text: tr(ctx, 'consent'), buttons: [{ id: 'consent:y', title: tr(ctx, 'agree') }, { id: 'consent:n', title: tr(ctx, 'disagree') }] });
    recordConsent(u.id, 'data_processing', yn, { interactionId: ctx.interactionId, channel: u.channel, lang: u.lang, answer: text });
    if (!yn) { U.setState(u.id, 'declined'); return reply(ctx, { text: tr(ctx, 'declined') }); }
    U.update(u.id, { consent_version: CONSENT_VERSION, consent_at: nowIso(), role: 'rider' });
    U.setState(u.id, 'await_name');
    return reply(ctx, { text: tr(ctx, 'ask_name'), audioKey: 'ask_name' });
  }
  if (s === 'await_name') {
    const name = text.replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/).slice(0, 3).join(' ');
    if (name.length < 2 || name.length > 40) return reply(ctx, { text: tr(ctx, 'ask_name') });
    U.setName(u.id, name);
    U.setState(u.id, 'await_vehicle');
    return reply(ctx, { text: tr(ctx, 'ask_vehicle'), buttons: [{ id: 'veh:keke', title: tr(ctx, 'v_keke') }, { id: 'veh:okada', title: tr(ctx, 'v_okada') }, { id: 'veh:bus', title: tr(ctx, 'v_bus') }] });
  }
  if (s === 'await_vehicle') {
    const v = text.startsWith('veh:') ? text.slice(4) : ({ '1': 'keke', keke: 'keke', '2': 'okada', okada: 'okada', '3': 'bus', bus: 'bus', car: 'car' } as Record<string, string>)[n];
    if (!v) return reply(ctx, { text: tr(ctx, 'ask_vehicle'), buttons: [{ id: 'veh:keke', title: tr(ctx, 'v_keke') }, { id: 'veh:okada', title: tr(ctx, 'v_okada') }, { id: 'veh:bus', title: tr(ctx, 'v_bus') }] });
    U.update(u.id, { vehicle: v });
    U.setState(u.id, 'await_ownership');
    return reply(ctx, { text: tr(ctx, 'ask_ownership'), buttons: [{ id: 'own:own', title: tr(ctx, 'o_own') }, { id: 'own:hire_purchase', title: tr(ctx, 'o_hp') }, { id: 'own:daily_rent', title: tr(ctx, 'o_rent') }] });
  }
  if (s === 'await_ownership') {
    const o = text.startsWith('own:') ? text.slice(4) : ({ '1': 'own', '2': 'hire_purchase', '3': 'daily_rent' } as Record<string, string>)[n];
    if (!o) return reply(ctx, { text: tr(ctx, 'ask_ownership'), buttons: [{ id: 'own:own', title: tr(ctx, 'o_own') }, { id: 'own:hire_purchase', title: tr(ctx, 'o_hp') }, { id: 'own:daily_rent', title: tr(ctx, 'o_rent') }] });
    U.update(u.id, { ownership: o });
    if (o === 'own') return askResearch(ctx);
    U.setState(u.id, 'await_owner_phone');
    return reply(ctx, { text: tr(ctx, 'ask_owner_phone') });
  }
  if (s === 'await_owner_phone') {
    if (n === '0' || n === 'skip') { U.setState(u.id, 'await_remit'); return reply(ctx, { text: tr(ctx, 'ask_remit') }); }
    const p = normalisePhone(text);
    if (!p || p === U.phoneOf(u)) return reply(ctx, { text: tr(ctx, 'bad_phone') });
    linkOwner(u, p);
    U.setState(u.id, 'await_remit');
    return reply(ctx, { text: tr(ctx, 'ask_remit') });
  }
  if (s === 'await_remit') {
    const a = extractAmounts(text, 100)[0];
    if (!a) return reply(ctx, { text: tr(ctx, 'ask_remit') });
    U.update(u.id, { daily_remit: a.value });
    return askResearch(ctx);
  }
  if (s === 'await_research') {
    const yn = text === 'res:y' ? true : text === 'res:n' ? false : yesNo(text);
    if (yn === null) return askResearch(ctx);
    U.update(u.id, { voice_research_opt_in: yn ? 1 : 0, onboarded_day: lagosDay() });
    recordConsent(u.id, 'voice_research', yn, { interactionId: ctx.interactionId });
    U.setState(u.id, 'active');
    return reply(ctx, { text: tr(ctx, 'ready', { name: U.nameOf(u).split(' ')[0] }), audioKey: 'ready' });
  }
  U.setState(u.id, 'active');
}

function askResearch(ctx: Ctx): void {
  U.setState(ctx.user.id, 'await_research');
  reply(ctx, { text: tr(ctx, 'ask_research'), buttons: [{ id: 'res:y', title: tr(ctx, 'yes') }, { id: 'res:n', title: tr(ctx, 'no') }] });
}

// ---------------------------------------------------------------- money logging
function typeLabel(lang: Lang, type: string) { return t(lang, 't_' + type); }

async function logMoney(ctx: Ctx, text: string): Promise<void> {
  const u = ctx.user;
  if (!text.trim()) return reply(ctx, { text: tr(ctx, 'help') });
  const r = await extract(text, { mock: config.modelMode === 'mock' });
  updateInteraction(ctx.interactionId, { modelPath: r.path, llmMs: r.llmMs, intent: r.intent, extracted: { entries: r.entries, day: r.day, unassigned: r.unassigned } });

  if (!r.entries.length) {
    if (r.intent === 'question' || /\?\s*$/.test(text)) {
      const ans = await answerQuestion(u.lang, text);
      if (ans) { updateInteraction(ctx.interactionId, { intent: 'question', modelPath: 'natlas', llmMs: ans.ms }); return reply(ctx, { text: ans.text }); }
    }
    return reply(ctx, { text: tr(ctx, 'not_understood') });
  }
  const day = r.day === 'yesterday' ? addDays(lagosDay(), -1) : lagosDay();
  const lines = r.entries.map((e) => `• ${typeLabel(u.lang, e.type)}: ${naira(e.amount)}`).join('\n');
  const dayWord = r.day === 'yesterday' ? tr(ctx, 'yesterday') : tr(ctx, 'today');
  U.setState(u.id, 'await_confirm', { entries: r.entries, day, interactionId: ctx.interactionId, source: ctx.source, agentId: ctx.agentId ?? null });
  const warn = r.lowConfidence || r.unassigned.length ? '\n' + tr(ctx, 'low_conf') : '';
  reply(ctx, { text: tr(ctx, 'confirm', { lines, day: `${dayWord} (${day})` }) + warn, buttons: [{ id: 'cf:y', title: tr(ctx, 'confirm_yes') }, { id: 'cf:n', title: tr(ctx, 'confirm_no') }] });
}

function commitDraft(ctx: Ctx): void {
  const u = fresh(ctx.user.id);
  const d = U.stateData<{ entries: Draft[]; day: string; interactionId: string; source: 'voice' | 'text' | 'agent'; agentId: string | null }>(u);
  if (!d?.entries?.length) { U.setState(u.id, 'active'); return; }
  const flags = checkDrafts(u.id, u.vehicle, d.day, d.entries);
  const saved = appendEntries(u.id, d.entries.map((e, i) => ({ type: e.type, amount: e.amount, day: d.day, source: d.source, agentId: d.agentId, interactionId: d.interactionId, flags: flags[i] })));
  setOutcome(d.interactionId, 'confirmed');
  const logs = (u.logs_count ?? 0) + 1;
  U.update(u.id, { logs_count: logs, last_active_day: d.day });
  U.setState(u.id, 'active');

  const dayRows = liveEntries(u.id, d.day, d.day);
  const income = dayRows.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0);
  const spent = dayRows.filter((x) => (EXPENSE_TYPES as string[]).includes(x.type) || (REPAYMENT_TYPES as string[]).includes(x.type)).reduce((a, x) => a + x.amount, 0);
  const dayWord = d.day === lagosDay() ? tr(ctx, 'today') : tr(ctx, 'yesterday');
  reply(ctx, { text: tr(ctx, 'saved', { day: dayWord.charAt(0).toUpperCase() + dayWord.slice(1), income: naira(income), spent: naira(spent), net: naira(income - spent) }) });

  if (u.owner_id) {
    for (const e of saved.filter((x) => (REPAYMENT_TYPES as string[]).includes(x.type))) {
      const res = requestAttestation(u, e);
      reply(ctx, { text: res.sentToOwner ? tr(ctx, 'attest_sent', { amount: naira(e.amount) }) : tr(ctx, 'attest_forward', { amount: naira(e.amount), link: res.link }) });
    }
  }
  if (logs === 5 && !u.rated) { U.setState(u.id, 'await_rating'); reply(ctx, { text: tr(ctx, 'rate') }); }
}

// ---------------------------------------------------------------- commands
async function command(ctx: Ctx, cmd: string): Promise<void> {
  const u = ctx.user;
  switch (cmd) {
    case 'hi': case 'help': U.setState(u.id, 'active'); return reply(ctx, { text: tr(ctx, 'help') });
    case 'language': U.setState(u.id, 'await_lang'); return reply(ctx, langMenu());
    case 'summary': return summary(ctx);
    case 'passport': return passport(ctx);
    case 'ev': {
      const est = evEstimate(u.id, u.vehicle);
      if (!est) return reply(ctx, { text: tr(ctx, 'ev_no_data') });
      U.setState(u.id, 'await_ev_lead');
      return reply(ctx, { text: tr(ctx, 'ev_result', { vehicle: est.vehicle, fuel: naira(est.fuelPerDay), elec: naira(est.elecPerDay),
        save: naira(Math.max(0, est.savingPerMonth)), payback: est.paybackMonths ?? '—' }) });
    }
    case 'stop_reminders': U.update(u.id, { reminders_off: 1 }); return reply(ctx, { text: tr(ctx, 'reminders_off') });
    case 'stop_sharing': revokeAll(u.id); return reply(ctx, { text: tr(ctx, 'sharing_stopped') });
    case 'my_data': {
      const tok = token(24);
      run('INSERT INTO web_sessions (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)', sha256(tok), u.id, 'export', new Date(Date.now() + 86400_000).toISOString());
      return reply(ctx, { text: tr(ctx, 'export', { link: `${config.publicBaseUrl}/api/export/${tok}` }) });
    }
    case 'delete':
      U.setState(u.id, 'await_delete');
      return reply(ctx, { text: tr(ctx, 'delete_confirm'), buttons: [{ id: 'del:y', title: tr(ctx, 'delete_yes') }, { id: 'del:n', title: tr(ctx, 'delete_no') }] });
    case 'pin': U.setState(u.id, 'await_pin'); return reply(ctx, { text: tr(ctx, 'ask_pin') });
  }
}

async function summary(ctx: Ctx): Promise<void> {
  const u = ctx.user;
  const days = dailyAggregates(u.id, addDays(lagosDay(), -6), lagosDay());
  if (!days.length) return reply(ctx, { text: tr(ctx, 'summary_empty') });
  const sum = (k: keyof (typeof days)[0]) => days.reduce((a, d) => a + (d[k] as number), 0);
  const fuel = liveEntries(u.id, addDays(lagosDay(), -6), lagosDay()).filter((e) => e.type === 'fuel').reduce((a, e) => a + e.amount, 0);
  const income = sum('income'), spent = sum('expenses'), repaid = sum('repaid');
  reply(ctx, { text: tr(ctx, 'summary', { days: days.length, income: naira(income), spent: naira(spent), repaid: naira(repaid), verified: naira(sum('repaidConfirmed')), net: naira(income - spent - repaid) }) });
  const tip = await weeklyTip(u.lang, { income, spent, fuel, repaid, days: days.length });
  if (tip) reply(ctx, { text: '💡 ' + tip });
}

function passport(ctx: Ctx): void {
  const u = fresh(ctx.user.id);
  const s = computeScore(u);
  if (s.status === 'building') return reply(ctx, { text: tr(ctx, 'passport_building', { n: s.stats.active_days, min: config.minScoreDays }) });
  issuePassport(u);
  const code = newShareCode(u.id);
  reply(ctx, { text: tr(ctx, 'passport_ready', { score: s.score!, band: s.band!, code, validity: config.shareCodeValidityDays, link: `${config.publicBaseUrl}/share/${code}` }) });
}

function grantDecision(ctx: Ctx, grantId: string, allow: boolean): void {
  const g = one('SELECT g.*, o.name org_name FROM grants g JOIN orgs o ON o.id = g.org_id WHERE g.id = ? AND g.user_id = ?', grantId, ctx.user.id);
  U.setState(ctx.user.id, 'active');
  if (!g) return;
  decideGrant(grantId, allow);
  reply(ctx, { text: tr(ctx, allow ? 'grant_ok' : 'grant_refused', { org: g.org_name }) });
}

/** Called by the lender/lessor API: ask the rider for permission. */
export function askRiderForGrant(user: User, grantId: string, orgName: string, scope: 'passport' | 'portfolio'): boolean {
  const msg: OutMsg = { text: t(user.lang, 'lender_request', { org: orgName, scope: t(user.lang, scope === 'passport' ? 'scope_passport' : 'scope_portfolio') }),
    buttons: [{ id: `grant:${grantId}:y`, title: t(user.lang, 'allow') }, { id: `grant:${grantId}:n`, title: t(user.lang, 'refuse') }] };
  const inWindow = !!user.last_inbound_at && Date.now() - Date.parse(user.last_inbound_at) < 23.5 * 3600_000;
  if (user.channel === 'whatsapp' && !inWindow) {
    if (!config.wa.approvedTemplates.has('ridepass_access_request')) return false;
    msg.template = { name: 'ridepass_access_request', params: [orgName], buttonPayloads: [`grant:${grantId}:y`, `grant:${grantId}:n`] };
  }
  if (user.state === 'active') U.setState(user.id, 'await_grant', { grantId });
  send(user, msg);
  return true;
}

registerHandler('inbound', async (payload: Inbound, attempt: number) => { await handleInbound(payload, attempt); });
export const _test = { yesNo, norm, LANGS };
