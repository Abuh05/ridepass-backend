// Public + rider-web + agent routes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { all, one, run } from '../db.ts';
import { HttpError, sendJson, sendText, serveFile, type Router } from '../http.ts';
import { enqueue } from '../jobs.ts';
import { parseWebhook, verifySignature } from '../channels/whatsapp.ts';
import type { Inbound } from '../channels/types.ts';
import { normalisePhone, nowIso, uid, naira } from '../util.ts';
import { checkSecret, hashSecret, sha256, publicKeyPem } from '../crypto.ts';
import * as U from '../users.ts';
import { redeemShareCode, logAccess } from '../grants.ts';
import { issuePassport, verifyPassport, latestPassport, type Passport } from '../passport.ts';
import { attestationByToken, respondAttestation, pinLocked, pinAttemptsLeft, recordPinFailure, clearPinFailures, type AttestVia } from '../attest.ts';
import { COUNTED_VIA } from '../scoring.ts';
import { newSession, requireOrg, sessionUser } from '../auth.ts';
import { liveEntries } from '../ledger.ts';

const PUBLIC = join(process.cwd(), 'public');
const page = (name: string) => (_req: any, res: any) => { if (!serveFile(res, join(PUBLIC, name))) sendText(res, 404, 'missing page'); };

function enqueueInbound(m: Inbound): void {
  enqueue('inbound', m, `u:${normalisePhone(m.from)}`);
}
function saveUpload(buf: Buffer): string {
  const dir = join(config.dataDir, 'tmp');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, uid());
  writeFileSync(p, buf);
  return p;
}

export function publicRoutes(r: Router): void {
  r.get('/health', (_q, s) => sendJson(s, 200, { ok: true, mode: config.modelMode, time: nowIso() }));
  r.get('/.well-known/ridepass-key.pem', (_q, s) => sendText(s, 200, publicKeyPem, 'application/x-pem-file'));

  // ---- WhatsApp webhook
  r.get('/webhook/whatsapp', (q, s) => {
    if (q.query.get('hub.mode') === 'subscribe' && q.query.get('hub.verify_token') === config.wa.verifyToken) return sendText(s, 200, q.query.get('hub.challenge') ?? '');
    sendText(s, 403, 'forbidden');
  });
  r.post('/webhook/whatsapp', (q, s) => {
    if (!verifySignature(q.rawBody!.toString('utf8'), q.headers['x-hub-signature-256'] as string | undefined)) return sendText(s, 401, 'bad signature');
    for (const m of parseWebhook(q.json)) enqueueInbound(m);
    sendText(s, 200, 'ok'); // acknowledge fast; work happens in the job queue
  }, { body: 'json', limit: 2_000_000 });

  // ---- Pages
  r.get('/rider', page('rider.html'));
  r.get('/agent', page('agent.html'));
  r.get('/dashboard', page('dashboard.html'));
  r.get('/verify', page('verify.html'));
  r.get('/admin', page('admin.html'));
  r.get('/guide', page('guide.html'));
  r.get('/privacy', page('privacy.html'));
  r.get('/share/:code', page('share.html'));
  r.get('/a/:token', page('attest.html'));

  // ---- Share code view (rider handed the code/link to someone)
  r.get('/api/share/:code', (q, s) => {
    const userId = redeemShareCode(q.params.code);
    if (!userId) throw new HttpError(404, 'This code is invalid or has expired.');
    const u = U.getUser(userId)!;
    let p = latestPassport(userId);
    // Re-issue when missing, expired, or signed by a previous key (key rotation / dev restart).
    if (!p || JSON.parse(p.payload).expires_at < new Date().toISOString().slice(0, 10) || !verifyPassport(JSON.parse(p.payload), p.signature).checks.signature) {
      issuePassport(u); p = latestPassport(userId);
    }
    logAccess(null, userId, 'share_code_view', { ua: String(q.headers['user-agent'] ?? '').slice(0, 120) });
    sendJson(s, 200, { payload: JSON.parse(p!.payload), signature: p!.signature });
  });
  r.post('/api/verify', (q, s) => {
    const { payload, signature } = q.json ?? {};
    if (!payload || !signature) throw new HttpError(400, 'payload and signature required');
    sendJson(s, 200, verifyPassport(payload as Passport, String(signature)));
  });

  // ---- Owner attestation by link (no WhatsApp template needed)
  r.get('/api/attest/:token', (q, s) => {
    const a = attestationByToken(q.params.token);
    if (!a) throw new HttpError(404, 'Link not valid');
    const e = one('SELECT * FROM entries WHERE id = ?', a.entry_id);
    const rider = U.getUser(a.rider_id as string);
    const owner = U.getUser(a.owner_id as string);
    sendJson(s, 200, { status: a.status, rider: rider ? U.nameOf(rider).split(' ')[0] : 'Rider', amount: e ? naira(e.amount) : '', day: e?.day, lang: rider?.lang ?? 'en',
      needs_pin: !!owner?.pin_hash, locked: owner?.pin_hash ? pinLocked(owner.id) : false });
  });
  r.post('/api/attest/:token', (q, s) => {
    const a = attestationByToken(q.params.token);
    if (!a) throw new HttpError(404, 'Link not valid');
    if (a.status !== 'pending') return sendJson(s, 200, { status: a.status, counted: COUNTED_VIA.includes(a.via) || a.status === 'disputed' });
    const confirm = !!q.json?.confirm;
    const owner = U.getUser(a.owner_id as string);
    let via: AttestVia = 'web_link';
    // Verified owners have a PIN set in person; the link alone is not enough to answer for them.
    if (owner?.pin_hash) {
      if (pinLocked(owner.id)) throw new HttpError(429, 'Too many wrong PINs. Try again in 24 hours, or ask a RidePass agent to reset the PIN.');
      if (!checkSecret(String(q.json?.pin ?? ''), owner.pin_hash)) {
        recordPinFailure(owner.id);
        throw new HttpError(403, `Wrong PIN. ${pinAttemptsLeft(owner.id)} attempt(s) left.`);
      }
      clearPinFailures(owner.id);
      via = 'web_pin';
    }
    const updated = respondAttestation(a.id as string, confirm, via);
    // A "Yes" without a PIN is recorded but not counted; a dispute always counts (no rider disputes their own payment).
    sendJson(s, 200, { status: updated?.status, counted: via === 'web_pin' || !confirm });
  });

  // ---- Data export (NDPA right of access); token from "MY DATA"
  r.get('/api/export/:token', (q, s) => {
    const sess = one(`SELECT * FROM web_sessions WHERE token_hash = ? AND kind = 'export'`, sha256(q.params.token));
    if (!sess || sess.expires_at < nowIso()) throw new HttpError(404, 'Link expired. Send MY DATA again.');
    const u = U.getUser(sess.user_id as string)!;
    const body = {
      exported_at: nowIso(),
      profile: { name: U.nameOf(u), phone: U.phoneOf(u), language: u.lang, vehicle: u.vehicle, ownership: u.ownership, daily_remit: u.daily_remit, member_since: u.onboarded_day },
      entries: liveEntries(u.id).map((e) => ({ day: e.day, type: e.type, amount: e.amount, source: e.source, flags: JSON.parse(e.flags), hash: e.hash })),
      consents: all('SELECT kind, version, granted, created_at FROM consents WHERE user_id = ?', u.id),
      sharing: all('SELECT g.scope, g.status, g.created_at, g.expires_at, o.name org FROM grants g JOIN orgs o ON o.id = g.org_id WHERE g.user_id = ?', u.id),
      who_viewed_my_data: all('SELECT a.action, a.at, o.name org FROM access_log a LEFT JOIN orgs o ON o.id = a.org_id WHERE a.user_id = ?', u.id),
    };
    sendText(s, 200, JSON.stringify(body, null, 2), 'application/json; charset=utf-8', { 'Content-Disposition': 'attachment; filename="ridepass-my-data.json"' });
  });

  // ---- Rider web app (fallback channel when WhatsApp is unavailable)
  r.post('/api/rider/login', (q, s) => {
    const phone = normalisePhone(String(q.json?.phone ?? ''));
    const u = phone ? U.findByPhone(phone) : undefined;
    // Owners have PINs too (for confirming payments); they must not be able to log in to the rider app.
    if (!u || u.role !== 'rider' || !checkSecret(String(q.json?.pin ?? ''), u.pin_hash)) throw new HttpError(401, 'Wrong phone number or PIN');
    sendJson(s, 200, { token: newSession('rider', u.id), lang: u.lang, name: U.nameOf(u).split(' ')[0] });
  });
  r.post('/api/rider/message', (q, s) => {
    const u = U.getUser(sessionUser(q, 'rider'))!;
    const text = String(q.json?.text ?? '').slice(0, 1000);
    const button = q.json?.button ? String(q.json.button).slice(0, 100) : undefined;
    enqueueInbound({ channel: 'web', from: U.phoneOf(u), kind: button ? 'button' : 'text', text, buttonId: button });
    sendJson(s, 202, { queued: true });
  });
  r.post('/api/rider/voice', (q, s) => {
    const u = U.getUser(sessionUser(q, 'rider'))!;
    if (!q.rawBody?.length) throw new HttpError(400, 'empty audio');
    enqueueInbound({ channel: 'web', from: U.phoneOf(u), kind: 'audio', audioPath: saveUpload(q.rawBody), mime: String(q.headers['content-type'] ?? 'audio/webm'),
      mockTranscript: config.modelMode === 'mock' ? String(q.headers['x-mock-transcript'] ?? '') || undefined : undefined });
    sendJson(s, 202, { queued: true });
  }, { body: 'raw', limit: config.maxAudioBytes });
  r.get('/api/rider/outbox', (q, s) => {
    const userId = sessionUser(q, 'rider');
    const after = Number(q.query.get('after') ?? 0);
    sendJson(s, 200, all('SELECT id, message, created_at FROM web_outbox WHERE user_id = ? AND id > ? ORDER BY id LIMIT 50', userId, after)
      .map((m) => ({ id: m.id, at: m.created_at, ...JSON.parse(m.message) })));
  });

  // ---- Field agent mode: agents at parks onboard feature-phone riders and record on their behalf
  r.post('/api/agent/rider', (q, s) => {
    requireOrg(q, ['agent']);
    const phone = normalisePhone(String(q.json?.phone ?? ''));
    if (!phone) throw new HttpError(400, 'invalid phone');
    const pin = String(q.json?.pin ?? '');
    let u = U.findByPhone(phone);
    if (!u) u = U.createUser(phone, { channel: 'web' });
    if (pin) { if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'PIN must be 4-6 digits'); U.update(u.id, { pin_hash: hashSecret(pin) }); }
    sendJson(s, 200, { ok: true, state: u.state, channel: u.channel });
  });
  r.post('/api/agent/message', (q, s) => {
    const org = requireOrg(q, ['agent']);
    const phone = normalisePhone(String(q.json?.phone ?? ''));
    if (!phone || !U.findByPhone(phone)) throw new HttpError(404, 'register the rider first');
    const button = q.json?.button ? String(q.json.button) : undefined;
    enqueueInbound({ channel: 'web', from: phone, kind: button ? 'button' : 'text', text: String(q.json?.text ?? ''), buttonId: button, agentId: org.id });
    sendJson(s, 202, { queued: true });
  });
  r.post('/api/agent/voice', (q, s) => {
    const org = requireOrg(q, ['agent']);
    const phone = normalisePhone(q.query.get('phone') ?? '');
    if (!phone || !U.findByPhone(phone)) throw new HttpError(404, 'register the rider first');
    enqueueInbound({ channel: 'web', from: phone, kind: 'audio', audioPath: saveUpload(q.rawBody!), mime: String(q.headers['content-type'] ?? 'audio/webm'), agentId: org.id,
      mockTranscript: config.modelMode === 'mock' ? String(q.headers['x-mock-transcript'] ?? '') || undefined : undefined });
    sendJson(s, 202, { queued: true });
  }, { body: 'raw', limit: config.maxAudioBytes });
  r.get('/api/agent/outbox', (q, s) => {
    requireOrg(q, ['agent']);
    const phone = normalisePhone(q.query.get('phone') ?? '');
    const u = phone ? U.findByPhone(phone) : undefined;
    if (!u) throw new HttpError(404, 'unknown rider');
    sendJson(s, 200, all('SELECT id, message, created_at FROM web_outbox WHERE user_id = ? AND id > ? ORDER BY id LIMIT 50', u.id, Number(q.query.get('after') ?? 0))
      .map((m) => ({ id: m.id, at: m.created_at, ...JSON.parse(m.message) })));
  });
  r.post('/api/agent/verify-owner', (q, s) => {
    const org = requireOrg(q, ['agent', 'lessor']);
    const phone = normalisePhone(String(q.json?.phone ?? ''));
    if (!phone) throw new HttpError(400, 'invalid phone');
    // The owner chooses this PIN in person; it is what proves a confirmation came from them.
    const pin = String(q.json?.pin ?? '');
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'Owner PIN must be 4-6 digits');
    const existing = U.findByPhone(phone);
    if (existing && existing.role === 'rider') throw new HttpError(409, 'This number belongs to a rider. Owners need their own phone number.');
    const owner = existing ?? U.createUser(phone, { role: 'owner' });
    U.update(owner.id, { verified_owner: 1, pin_hash: hashSecret(pin) });
    clearPinFailures(owner.id);
    logAccess(org.id, owner.id, 'owner_verified');
    sendJson(s, 200, { ok: true });
  });
  void run;
}
