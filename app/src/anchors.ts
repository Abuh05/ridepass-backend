// Daily ledger anchor. Once a day we take every rider's chain head and combine them into one Merkle
// root. The roots are public (GET /api/anchors), so anyone who keeps a copy (or a lender who saves it
// with a passport) can later prove that a rider's history existed in that exact form on that day:
// rebuilding a chain after the fact would no longer match the published root.
// Leaves use the pseudonymous rider ref (same as in passports), never names or phone numbers.
import { all, one, run, type Row } from './db.ts';
import { sha256 } from './crypto.ts';
import { lagosDay, nowIso } from './util.ts';
import { verifyChain } from './ledger.ts';

export type Leaf = { ref: string; count: number; head: string };
export type ProofStep = { sibling: string; side: 'left' | 'right' };

export const riderRef = (userId: string): string => sha256('rider:' + userId).slice(0, 16);
export const leafHash = (l: Leaf): string => sha256(`${l.ref}:${l.count}:${l.head}`);

/** Merkle root over leaf hashes (odd nodes are paired with themselves). Empty tree → sha256(''). */
export function merkleRoot(hashes: string[]): string {
  if (!hashes.length) return sha256('');
  let level = hashes;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}

export function merkleProof(hashes: string[], index: number): ProofStep[] {
  const proof: ProofStep[] = [];
  let level = hashes, i = index;
  while (level.length > 1) {
    const pair = i % 2 === 0 ? i + 1 : i - 1;
    proof.push({ sibling: level[pair] ?? level[i], side: i % 2 === 0 ? 'right' : 'left' });
    const next: string[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(sha256(level[j] + (level[j + 1] ?? level[j])));
    level = next; i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: string, proof: ProofStep[], root: string): boolean {
  let h = leaf;
  for (const p of proof) h = p.side === 'right' ? sha256(h + p.sibling) : sha256(p.sibling + h);
  return h === root;
}

function currentLeaves(): Leaf[] {
  return all('SELECT DISTINCT user_id FROM entries')
    .map((r) => { const c = verifyChain(r.user_id as string); return { ref: riderRef(r.user_id as string), count: c.count, head: c.head }; })
    .sort((a, b) => leafHash(a).localeCompare(leafHash(b)));
}

/** Create today's anchor (once per Lagos day). Returns the existing one if already made. */
export function createAnchor(day = lagosDay()): Row {
  const existing = one('SELECT day, root, riders, created_at FROM anchors WHERE day = ?', day);
  if (existing) return existing;
  const leaves = currentLeaves();
  const root = merkleRoot(leaves.map(leafHash));
  run('INSERT INTO anchors (day, root, riders, leaves, created_at) VALUES (?,?,?,?,?)', day, root, leaves.length, JSON.stringify(leaves), nowIso());
  return { day, root, riders: leaves.length, created_at: nowIso() };
}

export function listAnchors(limit = 90): Row[] {
  return all('SELECT day, root, riders, created_at FROM anchors ORDER BY day DESC LIMIT ?', limit);
}

/** Inclusion proof for one rider ref in a day's anchor, or null if that rider had no entries then. */
export function anchorProof(day: string, ref: string): { day: string; root: string; leaf: Leaf; leaf_hash: string; proof: ProofStep[] } | null {
  const a = one('SELECT * FROM anchors WHERE day = ?', day);
  if (!a) return null;
  const leaves = JSON.parse(a.leaves as string) as Leaf[];
  const i = leaves.findIndex((l) => l.ref === ref);
  if (i < 0) return null;
  const hashes = leaves.map(leafHash);
  return { day, root: a.root as string, leaf: leaves[i], leaf_hash: hashes[i], proof: merkleProof(hashes, i) };
}

/** Anchor once a day at 23:00 Lagos time (UTC+1). */
export function startAnchorClock(): NodeJS.Timeout {
  return setInterval(() => {
    if ((new Date().getUTCHours() + 1) % 24 !== 23) return;
    if (one('SELECT 1 FROM anchors WHERE day = ?', lagosDay())) return;
    const a = createAnchor();
    console.log(`[anchor] ${a.day}: root ${a.root} over ${a.riders} rider chains`);
  }, 60_000);
}
