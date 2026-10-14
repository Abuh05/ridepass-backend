import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptsFor, INBOUND_MAX_ATTEMPTS } from '../src/jobs.ts';

test('queued voice notes are retried for 24 hours (GPU off overnight), not just 6', () => {
  // Back-off doubles from 4 s up to a 10-minute cap; count how long the retries span.
  const span = (n: number) => Array.from({ length: n }, (_, i) => Math.min(600_000, 2 ** (i + 1) * 2000)).reduce((a, b) => a + b, 0);
  assert.equal(INBOUND_MAX_ATTEMPTS, attemptsFor(24));
  assert.ok(span(INBOUND_MAX_ATTEMPTS) >= 24 * 3600_000, 'covers a full day');
  assert.ok(span(INBOUND_MAX_ATTEMPTS - 1) < 24 * 3600_000, 'and not much more');
  assert.ok(attemptsFor(6) < INBOUND_MAX_ATTEMPTS);
});
