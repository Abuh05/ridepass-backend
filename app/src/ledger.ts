// Append-only, hash-chained ledger. Each entry commits to the previous entry's hash, so any edit or
// deletion of history is detectable when a passport is verified. Corrections are new "void" entries.
import { all, one, run, tx, type Row } from './db.ts';
import { sha256 } from './crypto.ts';
import { canonical, nowIso, uid } from './util.ts';
import type { EntryType } from './nlu/keywords.ts';

export const GENESIS = '0'.repeat(64);

export type NewEntry = { type: EntryType | 'void'; amount: number; day: string; source: 'voice' | 'text' | 'agent';
  ref?: string | null; agentId?: string | null; interactionId?: string | null; flags?: string[] };

function entryHash(e: { user_id: string; seq: number; day: string; type: string; amount: number; ref: string | null; source: string; flags: string; created_at: string; prev_hash: string }): string {
  return sha256(canonical({ u: e.user_id, s: e.seq, d: e.day, t: e.type, a: e.amount, r: e.ref, src: e.source, f: e.flags, c: e.created_at, p: e.prev_hash }));
}

export function appendEntries(userId: string, items: NewEntry[]): Row[] {
  return tx(() => {
    const last = one('SELECT seq, hash FROM entries WHERE user_id = ? ORDER BY seq DESC LIMIT 1', userId);
    let seq = (last?.seq as number) ?? 0;
    let prev = (last?.hash as string) ?? GENESIS;
    const out: Row[] = [];
    for (const it of items) {
      seq += 1;
      const e = { id: uid(), user_id: userId, seq, day: it.day, type: it.type, amount: Math.round(it.amount), ref: it.ref ?? null,
        source: it.source, flags: JSON.stringify(it.flags ?? []), created_at: nowIso(), prev_hash: prev };
      const hash = entryHash(e);
      run(`INSERT INTO entries (id,user_id,seq,day,type,amount,ref,source,agent_id,interaction_id,flags,prev_hash,hash,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, e.id, userId, seq, e.day, e.type, e.amount, e.ref, e.source, it.agentId ?? null,
          it.interactionId ?? null, e.flags, prev, hash, e.created_at);
      out.push({ ...e, hash });
      prev = hash;
    }
    return out;
  });
}

/** Recompute the whole chain. Returns head hash, count and whether everything is intact. */
export function verifyChain(userId: string, uptoSeq?: number): { ok: boolean; head: string; count: number; brokenAt?: number } {
  const rows = all('SELECT * FROM entries WHERE user_id = ? ORDER BY seq', userId);
  let prev = GENESIS;
  let count = 0;
  for (const r of rows) {
    if (uptoSeq !== undefined && (r.seq as number) > uptoSeq) break;
    if (r.prev_hash !== prev || r.seq !== count + 1) return { ok: false, head: prev, count, brokenAt: r.seq as number };
    const h = entryHash(r as any);
    if (h !== r.hash) return { ok: false, head: prev, count, brokenAt: r.seq as number };
    prev = h; count++;
  }
  return { ok: true, head: prev, count };
}

/** Live (non-voided) entries in a day range. */
export function liveEntries(userId: string, fromDay?: string, toDay?: string): Row[] {
  const rows = all(`SELECT * FROM entries WHERE user_id = ? ${fromDay ? 'AND day >= ?' : ''} ${toDay ? 'AND day <= ?' : ''} ORDER BY seq`,
    ...[userId, fromDay, toDay].filter((x) => x !== undefined));
  const voided = new Set(all(`SELECT ref FROM entries WHERE user_id = ? AND type = 'void'`, userId).map((r) => r.ref));
  return rows.filter((r) => r.type !== 'void' && !voided.has(r.id));
}

export function voidEntry(userId: string, entryId: string, source: 'voice' | 'text' | 'agent', day: string): void {
  appendEntries(userId, [{ type: 'void', amount: 0, day, source, ref: entryId }]);
}
