import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptsFor, INBOUND_MAX_ATTEMPTS, enqueue, registerHandler, tick } from '../src/jobs.ts';
import { resetDbForTests, run, one } from '../src/db.ts';

test('a voice note waiting for the GPU does not block the same rider\'s later messages', async () => {
  resetDbForTests();
  const ran: string[] = [];
  registerHandler('qtest', async (p) => { ran.push(p.n); });
  const waiting = enqueue('qtest', { n: 'voice note (GPU off)' }, 'u:rider1');
  run('UPDATE jobs SET run_at = ?, attempts = 5 WHERE id = ?', Date.now() + 3600_000, waiting); // waiting out a back-off
  enqueue('qtest', { n: 'typed SUMMARY' }, 'u:rider1');
  tick(); await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ran, ['typed SUMMARY'], 'the later message is answered now');
  assert.equal(one('SELECT status FROM jobs WHERE id = ?', waiting)!.status, 'queued', 'the voice note stays queued for later');
});

test('due messages from one rider still run strictly in order', async () => {
  resetDbForTests();
  const ran: string[] = [];
  registerHandler('qorder', async (p) => { ran.push(p.n); await new Promise((r) => setTimeout(r, 5)); });
  for (const n of ['1', '2', '3']) { enqueue('qorder', { n }, 'u:rider2'); await new Promise((r) => setTimeout(r, 2)); }
  for (let i = 0; i < 10 && ran.length < 3; i++) { tick(); await new Promise((r) => setTimeout(r, 15)); }
  assert.deepEqual(ran, ['1', '2', '3']);
});

test('queued voice notes are retried for 24 hours (GPU off overnight), not just 6', () => {
  // Back-off doubles from 4 s up to a 10-minute cap; count how long the retries span.
  const span = (n: number) => Array.from({ length: n }, (_, i) => Math.min(600_000, 2 ** (i + 1) * 2000)).reduce((a, b) => a + b, 0);
  assert.equal(INBOUND_MAX_ATTEMPTS, attemptsFor(24));
  assert.ok(span(INBOUND_MAX_ATTEMPTS) >= 24 * 3600_000, 'covers a full day');
  assert.ok(span(INBOUND_MAX_ATTEMPTS - 1) < 24 * 3600_000, 'and not much more');
  assert.ok(attemptsFor(6) < INBOUND_MAX_ATTEMPTS);
});
