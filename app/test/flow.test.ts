import './setup.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDbForTests, all, run, one } from '../src/db.ts';
import { handleInbound } from '../src/flow.ts';
import { drain } from '../src/jobs.ts';
import * as U from '../src/users.ts';
import { appendEntries, verifyChain, liveEntries } from '../src/ledger.ts';
import { computeScore, affordability } from '../src/scoring.ts';
import { issuePassport, verifyPassport } from '../src/passport.ts';
import { attestationByToken, respondAttestation } from '../src/attest.ts';
import { redeemShareCode } from '../src/grants.ts';
import { addDays, lagosDay } from '../src/util.ts';
import { config } from '../src/config.ts';
import { metrics } from '../src/interactions.ts';

const RIDER = '08031234567';
const OWNER = '08099990000';
let n = 0;
async function say(text: string, from = RIDER) { await handleInbound({ channel: 'web', from, kind: 'text', text, externalId: `m${++n}` }); await drain(); }
async function tap(buttonId: string, from = RIDER) { await handleInbound({ channel: 'web', from, kind: 'button', buttonId, externalId: `m${++n}` }); await drain(); }
async function voice(transcript: string, from = RIDER) { await handleInbound({ channel: 'web', from, kind: 'audio', mockTranscript: transcript, externalId: `m${++n}` }); await drain(); }
const outbox = (phone = RIDER) => { const u = U.findByPhone('234' + phone.slice(1)); return u ? all('SELECT message FROM web_outbox WHERE user_id = ? ORDER BY id', u.id).map((m) => JSON.parse(m.message)) : []; };
const last = (phone = RIDER) => outbox(phone).at(-1);
const rider = () => U.findByPhone('2348031234567')!;

async function onboard(ownership: 'own' | 'hire_purchase' = 'hire_purchase', lang = 'en') {
  await say('hi');
  await tap(`lang:${lang}`);
  await tap('consent:y');
  await say('Musa Ibrahim');
  await tap('veh:keke');
  await tap(`own:${ownership}`);
  if (ownership !== 'own') { await say(OWNER); await say('3000'); }
  await tap('res:n');
}

beforeEach(() => { resetDbForTests(); n = 0; });

test('full onboarding with consent', async () => {
  await onboard();
  const u = rider();
  assert.equal(u.state, 'active');
  assert.equal(u.vehicle, 'keke');
  assert.equal(u.daily_remit, 3000);
  assert.ok(u.consent_at);
  assert.equal(U.nameOf(u), 'Musa Ibrahim');
  assert.ok(u.owner_id);
  assert.match(last().text, /You are set, Musa/);
  assert.equal(one(`SELECT COUNT(*) c FROM consents WHERE user_id = ? AND kind = 'data_processing' AND granted = 1`, u.id)!.c, 1);
});

test('declining consent stores no profile', async () => {
  await say('hi'); await tap('lang:ha'); await tap('consent:n');
  const u = rider();
  assert.equal(u.state, 'declined');
  assert.equal(u.consent_at, null);
  assert.match(last().text, /Babu damuwa/);
});

test('voice log → read-back → confirm → hash-chained ledger + owner attestation link', async () => {
  await onboard();
  await voice('I made 14 thousand today, fuel 5,200, I paid owner 3,000');
  const confirm = last();
  assert.match(confirm.text, /Income: ₦14,000/);
  assert.match(confirm.text, /Owner payment: ₦3,000/);
  assert.deepEqual(confirm.buttons.map((b: any) => b.id), ['cf:y', 'cf:n']);
  assert.equal(liveEntries(rider().id).length, 0, 'nothing saved before confirmation');
  await tap('cf:y');
  const entries = liveEntries(rider().id);
  assert.equal(entries.length, 3);
  assert.ok(verifyChain(rider().id).ok);
  const msgs = outbox().map((m) => m.text).join('\n');
  assert.match(msgs, /Saved ✅/);
  const link = msgs.match(/https:\/\/ridepass\.test\/a\/([\w-]+)/);
  assert.ok(link, 'owner cannot be messaged on WhatsApp yet, so rider gets a link to forward');
  const att = attestationByToken(link![1])!;
  respondAttestation(att.id, true, 'web_pin');
  assert.equal(one('SELECT status FROM attestations WHERE id = ?', att.id)!.status, 'confirmed');
  const inter = one(`SELECT * FROM interactions WHERE kind = 'audio' AND direction = 'in'`)!;
  assert.equal(inter.outcome, 'confirmed');
  assert.equal(inter.model_path, 'mock');
});

test('a voice note on a button step tells the rider to tap, then re-asks with the buttons', async () => {
  await say('hi'); await tap('lang:pcm'); await tap('consent:y'); await say('Blessing');
  assert.equal(rider().state, 'await_vehicle');
  await voice('keke'); // what the stuck rider did: talking instead of tapping
  const [hint, again] = outbox().slice(-2);
  assert.match(hint.text, /Abeg press one of the buttons/);
  assert.match(again.text, /motor/);
  assert.deepEqual(again.buttons.map((b: any) => b.id), ['veh:keke', 'veh:okada', 'veh:bus']);
  assert.equal(rider().state, 'await_vehicle', 'still waiting for the tap');
  await tap('veh:keke');
  assert.equal(rider().state, 'await_ownership');
});

test('rejecting the read-back saves nothing and is counted as a correction', async () => {
  await onboard('own');
  await voice('I made 14 thousand');
  await tap('cf:n');
  assert.equal(liveEntries(rider().id).length, 0);
  assert.equal(one(`SELECT outcome FROM interactions WHERE kind = 'audio'`)!.outcome, 'corrected');
  assert.match(last().text, /not saved/);
});

test('Hausa rider gets Hausa replies', async () => {
  await onboard('own', 'ha');
  await voice('Yau na samu dubu goma sha huɗu, mai dubu biyar');
  assert.match(last().text, /Kuɗin shiga: ₦14,000/);
  assert.match(last().text, /Daidai ne\?/);
});

test('owner disputes a payment → rider told, verification drops', async () => {
  await onboard();
  await voice('owner 3000');
  await tap('cf:y');
  const att = one('SELECT * FROM attestations')!;
  respondAttestation(att.id, false, 'web_link');
  await drain();
  assert.match(outbox().map((m) => m.text).join('\n'), /said the ₦3,000 payment/);
});

test('a "Yes" on the forwarded link without a PIN is recorded but does not count as owner-confirmed', async () => {
  await onboard();
  await voice('owner 3000'); await tap('cf:y');
  const att = one('SELECT * FROM attestations')!;
  respondAttestation(att.id, true, 'web_link');
  assert.equal(one('SELECT status FROM attestations WHERE id = ?', att.id)!.status, 'confirmed', 'the answer is kept for the record');
  assert.equal(computeScore(rider()).stats.total_repaid_confirmed, 0, 'but it does not count');
  run(`UPDATE attestations SET via = 'web_pin' WHERE id = ?`, att.id);
  assert.equal(computeScore(rider()).stats.total_repaid_confirmed, 3000, 'a PIN-verified answer counts');
});

test('only the owner can answer a payment confirmation by button', async () => {
  await onboard();
  await voice('owner 3000'); await tap('cf:y');
  const att = one('SELECT * FROM attestations')!;
  await tap(`att:${att.id}:y`); // the rider tries to confirm their own payment
  assert.equal(one('SELECT status FROM attestations WHERE id = ?', att.id)!.status, 'pending');
  await tap(`att:${att.id}:y`, OWNER); // the owner answers from their own number
  assert.equal(one('SELECT via FROM attestations WHERE id = ?', att.id)!.via, 'whatsapp');
});

test('score needs 14 days, then a signed passport verifies; tampering is detected', async () => {
  await onboard();
  const u = rider();
  run('UPDATE users SET onboarded_day = ? WHERE id = ?', addDays(lagosDay(), -29), u.id);
  assert.equal(computeScore(rider()).status, 'building');
  for (let i = 0; i < 25; i++) {
    const day = addDays(lagosDay(), -i);
    const saved = appendEntries(u.id, [
      { type: 'income', amount: 13000 + (i % 3) * 1000, day, source: 'voice' },
      { type: 'fuel', amount: 4500, day, source: 'voice' },
      { type: 'owner_payment', amount: 3000, day, source: 'voice' },
    ]);
    run(`INSERT INTO attestations (id, entry_id, rider_id, owner_id, token_hash, status, via, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      'a' + i, saved[2].id, u.id, u.owner_id, 'x' + i, i % 5 === 0 ? 'pending' : 'confirmed', 'whatsapp', new Date().toISOString());
  }
  const s = computeScore(rider());
  assert.equal(s.status, 'scored');
  assert.ok(s.score! >= 60, `score ${s.score}`);
  assert.ok(s.reasons.positive.length > 0);
  assert.equal(affordability(s, 2000).verdict, 'affordable');
  assert.equal(affordability(s, 9000).verdict, 'unaffordable');

  const { payload, signature } = issuePassport(rider());
  assert.equal(verifyPassport(payload, signature).valid, true);
  // Forged score in the payload → signature fails
  assert.equal(verifyPassport({ ...payload, score: { ...payload.score, value: 99 } }, signature).checks.signature, false);
  // Someone edits an old amount directly in the database → ledger check fails
  run(`UPDATE entries SET amount = 50000 WHERE user_id = ? AND seq = 1`, u.id);
  const v = verifyPassport(payload, signature);
  assert.equal(v.checks.ledger_unchanged, false);
  assert.equal(v.valid, false);
});

test('PASSPORT command issues share code that resolves to the rider', async () => {
  await onboard('own');
  const u = rider();
  run('UPDATE users SET onboarded_day = ? WHERE id = ?', addDays(lagosDay(), -20), u.id);
  for (let i = 0; i < 16; i++) appendEntries(u.id, [{ type: 'income', amount: 12000, day: addDays(lagosDay(), -i), source: 'voice' }, { type: 'savings', amount: 1000, day: addDays(lagosDay(), -i), source: 'voice' }]);
  await say('passport');
  const m = last().text.match(/\*([A-Z0-9]{8})\*/);
  assert.ok(m, last().text);
  assert.equal(redeemShareCode(m![1]), u.id);
});

test('anomalies: implausible income is flagged', async () => {
  await onboard('own');
  await voice('I made 900 thousand today');
  await tap('cf:y');
  const e = liveEntries(rider().id)[0];
  assert.deepEqual(JSON.parse(e.flags), ['implausible_amount']);
});

test('delete my data erases everything', async () => {
  await onboard();
  await voice('I made 10k'); await tap('cf:y');
  await say('delete my data');
  await tap('del:y');
  assert.equal(U.findByPhone('2348031234567'), undefined);
  assert.equal(one('SELECT COUNT(*) c FROM entries')!.c, 0);
});

test('licence guard waitlists new riders at the cap', async () => {
  const cap = config.userCap;
  config.userCap = 1;
  try {
    await onboard('own');
    await say('hi', '08050000001');
    assert.match(last('08050000001').text, /full for now/);
    assert.equal(U.findByPhone('2348050000001')!.status, 'waitlist');
  } finally { config.userCap = cap; }
});

test('duplicate webhook deliveries are processed once', async () => {
  await onboard('own');
  const m = { channel: 'web' as const, from: RIDER, kind: 'text' as const, text: 'I made 5000', externalId: 'dup-1' };
  await handleInbound(m); await handleInbound(m); await drain();
  assert.equal(all(`SELECT * FROM interactions WHERE external_id = 'dup-1'`).length, 1);
});

test('EV estimate uses the rider\'s own fuel logs', async () => {
  await onboard('own');
  const u = rider();
  for (let i = 0; i < 5; i++) appendEntries(u.id, [{ type: 'fuel', amount: 5000, day: addDays(lagosDay(), -i), source: 'voice' }]);
  await say('ev');
  assert.match(last().text, /save about/);
  await say('1');
  assert.equal(one('SELECT COUNT(*) c FROM ev_leads')!.c, 1);
});

test('metrics exclude mock interactions from language stats', async () => {
  await onboard('own');
  await voice('I made 10k'); await tap('cf:y');
  const m = metrics();
  assert.equal(m.voice_notes, 0);
});

test('STOP turns reminders off; reminders skip riders who logged today', async () => {
  const { sendReminders } = await import('../src/reminders.ts');
  await onboard('own');
  assert.equal(sendReminders().sent, 1);
  await voice('I made 10k'); await tap('cf:y');
  assert.equal(sendReminders().sent, 0, 'already logged today');
  run('UPDATE users SET last_active_day = NULL WHERE id = ?', rider().id);
  await say('stop');
  assert.equal(rider().reminders_off, 1);
  assert.equal(sendReminders().sent, 0);
});
