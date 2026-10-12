// Operations: database backups and honest handling of WhatsApp when it is not connected.
import './setup.ts';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resetDbForTests, all, one } from '../src/db.ts';
import { Router } from '../src/http.ts';
import { publicRoutes } from '../src/routes/public.ts';
import { orgRoutes } from '../src/routes/org.ts';
import * as U from '../src/users.ts';
import { linkOwner, requestAttestation } from '../src/attest.ts';
import { send, whatsappConfigured } from '../src/channels/send.ts';
import { appendEntries } from '../src/ledger.ts';
import { dailyBackup, backupDir, listBackups } from '../src/backup.ts';
import { lagosDay, nowIso } from '../src/util.ts';

const router = new Router(); publicRoutes(router); orgRoutes(router);
let server: Server, base = '';
before(async () => {
  server = createServer((q, s) => void router.handle(q, s, join(process.cwd(), 'public')));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as any).port}`;
});
after(() => { server.close(); rmSync(backupDir(), { recursive: true, force: true }); });
beforeEach(() => { resetDbForTests(); rmSync(backupDir(), { recursive: true, force: true }); });

test('daily backup writes a readable SQLite snapshot and keeps only the newest N daily files', () => {
  U.createUser('2348031111111');
  mkdirSync(backupDir(), { recursive: true });
  writeFileSync(join(backupDir(), 'ridepass-before-reset-x.db'), 'keep me'); // non-daily files are never pruned
  for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) dailyBackup(day, 3);
  const files = readdirSync(backupDir()).sort();
  assert.deepEqual(files, ['ridepass-2026-10-02.db', 'ridepass-2026-10-03.db', 'ridepass-2026-10-04.db', 'ridepass-before-reset-x.db']);
  assert.equal(readFileSync(join(backupDir(), 'ridepass-2026-10-04.db')).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal(listBackups().length, 4);
});

test('admins can download a fresh backup; nobody else can', async () => {
  U.createUser('2348032222222');
  assert.equal((await fetch(base + '/api/admin/backup')).status, 401);
  const r = await fetch(base + '/api/admin/backup', { headers: { 'x-admin-key': 'test-admin-key' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="ridepass-\d{4}-\d{2}-\d{2}\.db"/);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  const m = await (await fetch(base + '/api/admin/metrics', { headers: { 'x-admin-key': 'test-admin-key' } })).json() as any;
  assert.equal(m.whatsapp_connected, false);
});

test('without WhatsApp credentials, messages to WhatsApp users are logged as undelivered, never queued', () => {
  assert.equal(whatsappConfigured(), false);
  const owner = U.createUser('2348099990000', { role: 'owner', channel: 'whatsapp' });
  send(owner, { text: 'hello owner' });
  assert.equal(one(`SELECT kind FROM interactions WHERE user_id = ? AND direction = 'out'`, owner.id)!.kind, 'undelivered');
  assert.equal(all(`SELECT 1 FROM jobs WHERE kind = 'wa_send'`).length, 0);
});

test('owner confirmations fall back to the rider-forwarded link when WhatsApp is not connected', () => {
  const rider = U.createUser('2348031234567', { channel: 'web' });
  U.update(rider.id, { consent_at: nowIso() });
  const owner = linkOwner(U.getUser(rider.id)!, '2348099990000');
  U.update(owner.id, { last_inbound_at: nowIso() }); // owner messaged recently: would be "within the window"
  const [e] = appendEntries(rider.id, [{ type: 'owner_payment', amount: 3000, day: lagosDay(), source: 'voice' }]);
  const r = requestAttestation(U.getUser(rider.id)!, e);
  assert.equal(r.sentToOwner, false, 'rider must forward the link: nothing can reach the owner');
  assert.match(r.link, /\/a\//);
});
