import './setup.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDbForTests, run } from '../src/db.ts';
import * as U from '../src/users.ts';
import { appendEntries, verifyChain } from '../src/ledger.ts';
import { computeScore } from '../src/scoring.ts';
import { merkleRoot, merkleProof, verifyProof, createAnchor, anchorProof, listAnchors, riderRef, leafHash } from '../src/anchors.ts';
import { sha256 } from '../src/crypto.ts';
import { lagosDay, nowIso } from '../src/util.ts';

beforeEach(() => resetDbForTests());

test('Merkle proofs verify for every leaf, for odd and even tree sizes', () => {
  for (const n of [1, 2, 3, 5, 8]) {
    const hashes = Array.from({ length: n }, (_, i) => sha256('leaf' + i));
    const root = merkleRoot(hashes);
    hashes.forEach((h, i) => assert.ok(verifyProof(h, merkleProof(hashes, i), root), `n=${n} i=${i}`));
    assert.equal(verifyProof(sha256('not a leaf'), merkleProof(hashes, 0), root), false);
  }
});

test('the daily anchor proves a rider history, and a rebuilt history no longer matches', () => {
  const a = U.createUser('2348031111111'), b = U.createUser('2348032222222');
  const day = lagosDay();
  appendEntries(a.id, [{ type: 'income', amount: 14000, day, source: 'voice' }, { type: 'owner_payment', amount: 3000, day, source: 'voice' }]);
  appendEntries(b.id, [{ type: 'income', amount: 9000, day, source: 'text' }]);
  const anchor = createAnchor();
  assert.equal(anchor.riders, 2);
  assert.equal(createAnchor().root, anchor.root, 'one anchor per day');
  assert.equal(listAnchors()[0].root, anchor.root);

  const p = anchorProof(day, riderRef(a.id))!;
  assert.ok(verifyProof(p.leaf_hash, p.proof, anchor.root), 'rider A is in the published root');
  assert.equal(p.leaf.head, verifyChain(a.id).head);

  // An operator rewrites A's history and recomputes a perfectly valid chain (₦14,000 → ₦40,000).
  run('DELETE FROM entries WHERE user_id = ?', a.id);
  appendEntries(a.id, [{ type: 'income', amount: 40000, day, source: 'voice' }, { type: 'owner_payment', amount: 3000, day, source: 'voice' }]);
  const rebuilt = verifyChain(a.id);
  assert.equal(rebuilt.ok, true, 'the rebuilt chain is internally consistent');
  assert.notEqual(leafHash({ ref: riderRef(a.id), count: rebuilt.count, head: rebuilt.head }), p.leaf_hash, '…but no longer matches the anchored leaf');
  assert.equal(anchorProof(day, 'unknownref'), null);
});

test('passport stats show how entries were recorded (voice / typed / agent)', () => {
  const u = U.createUser('2348033333333');
  run('UPDATE users SET onboarded_day = ?, consent_at = ? WHERE id = ?', lagosDay(), nowIso(), u.id);
  const day = lagosDay();
  appendEntries(u.id, [
    { type: 'income', amount: 14000, day, source: 'voice' }, { type: 'fuel', amount: 5000, day, source: 'voice' },
    { type: 'owner_payment', amount: 3000, day, source: 'text' }, { type: 'income', amount: 1000, day, source: 'agent' },
  ]);
  const s = computeScore(U.getUser(u.id)!).stats;
  assert.deepEqual([s.recorded_voice_pct, s.recorded_typed_pct, s.recorded_with_agent_pct], [50, 25, 25]);
});
