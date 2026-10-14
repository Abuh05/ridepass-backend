// HTTP tests for owner verification: PIN-protected payment links, lockout, and rider-only login.
import './setup.ts';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { resetDbForTests, one, run } from '../src/db.ts';
import { Router } from '../src/http.ts';
import { publicRoutes } from '../src/routes/public.ts';
import { orgRoutes } from '../src/routes/org.ts';
import { createOrg } from '../src/auth.ts';
import * as U from '../src/users.ts';
import { linkOwner } from '../src/attest.ts';
import { sha256, hashSecret } from '../src/crypto.ts';
import { appendEntries } from '../src/ledger.ts';
import { lagosDay, uid, nowIso } from '../src/util.ts';
import '../src/flow.ts';

const router = new Router(); publicRoutes(router); orgRoutes(router);
let server: Server, base = '';
before(async () => {
  server = createServer((q, s) => void router.handle(q, s, join(process.cwd(), 'public')));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

let agentKey = '', tok = '';
beforeEach(() => {
  resetDbForTests();
  agentKey = createOrg('Agent Aisha', 'agent').apiKey;
  const rider = U.createUser('2348031234567', { channel: 'web' });
  U.update(rider.id, { consent_at: nowIso(), pin_hash: hashSecret('1234'), vehicle: 'keke' });
  const owner = linkOwner(U.getUser(rider.id)!, '2348099990000');
  const [e] = appendEntries(rider.id, [{ type: 'owner_payment', amount: 3000, day: lagosDay(), source: 'voice' }]);
  tok = 'tok' + uid();
  run('INSERT INTO attestations (id, entry_id, rider_id, owner_id, token_hash, created_at) VALUES (?,?,?,?,?,?)', uid(), e.id, rider.id, owner.id, sha256(tok), nowIso());
});
const verifyOwner = (pin: string) => call('POST', '/api/agent/verify-owner', { phone: '08099990000', pin }, { 'x-api-key': agentKey });
const att = () => ({ ...one('SELECT status, via FROM attestations')! });

test('an unverified owner can still answer, but the "Yes" is not counted', async () => {
  assert.equal((await call('GET', `/api/attest/${tok}`)).json.needs_pin, false);
  const r = await call('POST', `/api/attest/${tok}`, { confirm: true });
  assert.equal(r.json.counted, false);
  assert.deepEqual(att(), { status: 'confirmed', via: 'web_link' });
});

test('verifying an owner requires a PIN, and the link then needs that PIN', async () => {
  assert.equal((await verifyOwner('')).status, 400);
  assert.equal((await verifyOwner('12')).status, 400);
  assert.equal((await verifyOwner('4826')).status, 200);
  assert.equal((await call('GET', `/api/attest/${tok}`)).json.needs_pin, true);
  assert.equal((await call('POST', `/api/attest/${tok}`, { confirm: true })).status, 403, 'no PIN: refused');
  assert.equal((await call('POST', `/api/attest/${tok}`, { confirm: true, pin: '1111' })).status, 403, 'wrong PIN: refused');
  assert.equal(att().status, 'pending');
  const ok = await call('POST', `/api/attest/${tok}`, { confirm: true, pin: '4826' });
  assert.equal(ok.json.counted, true);
  assert.deepEqual(att(), { status: 'confirmed', via: 'web_pin' });
});

test('five wrong PINs lock the owner for 24 hours, even with the right PIN', async () => {
  await verifyOwner('4826');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', `/api/attest/${tok}`, { confirm: true, pin: '0000' })).status, 403);
  assert.equal((await call('POST', `/api/attest/${tok}`, { confirm: true, pin: '4826' })).status, 429);
  assert.equal((await call('GET', `/api/attest/${tok}`)).json.locked, true);
  assert.equal(att().status, 'pending');
  await verifyOwner('7391'); // an agent resets the PIN in person
  assert.equal((await call('POST', `/api/attest/${tok}`, { confirm: true, pin: '7391' })).status, 200);
});

test('agents can read where a rider is in the conversation (for the progress view); others cannot', async () => {
  assert.equal((await call('GET', '/api/agent/rider?phone=08031234567')).status, 401);
  const r = await call('GET', '/api/agent/rider?phone=08031234567', undefined, { 'x-api-key': agentKey });
  assert.equal(r.status, 200);
  assert.equal(r.json.consented, true);
  assert.equal(r.json.vehicle, 'keke');
  assert.ok('state' in r.json && 'lang' in r.json && 'first_name' in r.json);
  assert.equal((await call('GET', '/api/agent/rider?phone=08000000001', undefined, { 'x-api-key': agentKey })).status, 404);
});

test('a rider phone cannot be registered as an owner, and owners cannot log in as riders', async () => {
  assert.equal((await call('POST', '/api/agent/verify-owner', { phone: '08031234567', pin: '5555' }, { 'x-api-key': agentKey })).status, 409);
  await verifyOwner('4826');
  assert.equal((await call('POST', '/api/rider/login', { phone: '08099990000', pin: '4826' })).status, 401);
  assert.equal((await call('POST', '/api/rider/login', { phone: '08031234567', pin: '1234' })).status, 200);
});
