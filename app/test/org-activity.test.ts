// HTTP tests for the admin "Key activity" log: sign-ins, actions and rejected keys, without the agent app's polling.
import './setup.ts';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { resetDbForTests } from '../src/db.ts';
import { Router } from '../src/http.ts';
import { publicRoutes } from '../src/routes/public.ts';
import { orgRoutes } from '../src/routes/org.ts';
import { createOrg } from '../src/auth.ts';
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
const admin = { 'x-admin-key': 'test-admin-key' };

let agentKey = '', lessorKey = '';
beforeEach(() => {
  resetDbForTests();
  agentKey = createOrg('Judges field agent', 'agent').apiKey;
  lessorKey = createOrg('Judges lessor', 'lessor').apiKey;
});

test('sign-ins and actions are logged per organisation; polling is not', async () => {
  const k = { 'x-api-key': agentKey };
  await call('GET', '/api/org/me', undefined, k);
  await call('POST', '/api/agent/rider', { phone: '08099990101', pin: '1234' }, k);
  for (let i = 0; i < 3; i++) { await call('GET', '/api/agent/outbox?phone=08099990101', undefined, k); await call('GET', '/api/agent/rider?phone=08099990101', undefined, k); }
  const act = (await call('GET', '/api/admin/activity', undefined, admin)).json;
  assert.deepEqual(act.map((a: any) => a.action), ['Opened a rider', 'Signed in']);
  assert.ok(act.every((a: any) => a.org === 'Judges field agent' && a.ok === 1));
  const org = (await call('GET', '/api/admin/orgs', undefined, admin)).json.find((o: any) => o.name === 'Judges field agent');
  assert.equal(org.sign_ins, 1);
  assert.equal(org.actions, 1);
  assert.ok(org.last_used_at);
});

test('a wrong secret or a key used in the wrong app is logged as rejected', async () => {
  await call('GET', '/api/org/me', undefined, { 'x-api-key': lessorKey.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) });
  await call('POST', '/api/agent/rider', { phone: '08099990101' }, { 'x-api-key': lessorKey });
  const act = (await call('GET', '/api/admin/activity', undefined, admin)).json;
  assert.deepEqual(act.map((a: any) => [a.action, a.ok]), [['Used the key in the wrong app (Opened a rider)', 0], ['Wrong key entered (Signed in)', 0]]);
  const org = (await call('GET', '/api/admin/orgs', undefined, admin)).json.find((o: any) => o.name === 'Judges lessor');
  assert.equal(org.last_used_at, null, 'rejected attempts do not count as use');
});

test('the activity log needs the admin key', async () => {
  assert.equal((await call('GET', '/api/admin/activity')).status, 401);
});
