// Signed, verifiable credit passport.
import { one, run, all, type Row } from './db.ts';
import { config } from './config.ts';
import { canonical, nowIso, uid, addDays, lagosDay } from './util.ts';
import { signText, verifyText, sha256, publicKeyPem } from './crypto.ts';
import { computeScore } from './scoring.ts';
import { verifyChain } from './ledger.ts';
import { nameOf } from './users.ts';

export type Passport = {
  v: 1; id: string; issuer: 'RidePass (Phoenix Renewable Group)'; issued_at: string; expires_at: string;
  rider: { ref: string; first_name: string; vehicle: string | null; ownership: string | null; member_since: string };
  score: { status: string; value: number | null; band: string | null; reasons: { positive: string[]; negative: string[] }; components: Record<string, unknown> };
  stats: Record<string, number | string>;
  ledger: { entries: number; head: string; integrity: boolean };
  model: { asr: string; llm: string };
};

export function issuePassport(user: Row): { payload: Passport; signature: string } {
  const s = computeScore(user);
  const chain = verifyChain(user.id);
  const first = (nameOf(user).split(/\s+/)[0] || 'Rider').slice(0, 30);
  const payload: Passport = {
    v: 1, id: uid(), issuer: 'RidePass (Phoenix Renewable Group)', issued_at: nowIso(),
    expires_at: addDays(lagosDay(), config.passportValidityDays),
    rider: { ref: sha256('rider:' + user.id).slice(0, 16), first_name: first, vehicle: user.vehicle, ownership: user.ownership, member_since: s.stats.member_since },
    score: { status: s.status, value: s.score, band: s.band, reasons: s.reasons, components: s.components },
    stats: s.stats as unknown as Record<string, number | string>,
    ledger: { entries: chain.count, head: chain.head, integrity: chain.ok },
    model: { asr: 'NCAIR1 N-ATLAS ASR (en/ha/yo/ig)', llm: 'NCAIR1/N-ATLaS' },
  };
  const signature = signText(canonical(payload));
  run('INSERT INTO passports (id, user_id, payload, signature, issued_at) VALUES (?,?,?,?,?)', payload.id, user.id, JSON.stringify(payload), signature, payload.issued_at);
  return { payload, signature };
}

/** Verify a passport someone presents: signature, expiry, and that the rider's ledger still matches the signed head. */
export function verifyPassport(payload: Passport, signature: string): { valid: boolean; checks: Record<string, boolean>; note?: string } {
  const checks: Record<string, boolean> = {};
  checks.signature = verifyText(canonical(payload), signature);
  checks.not_expired = payload.expires_at >= lagosDay();
  const rec = one('SELECT user_id FROM passports WHERE id = ?', payload.id);
  checks.issued_by_us = !!rec;
  if (rec) {
    const chain = verifyChain(rec.user_id as string, payload.ledger.entries);
    checks.ledger_unchanged = chain.ok && chain.head === payload.ledger.head;
  } else checks.ledger_unchanged = false;
  const valid = Object.values(checks).every(Boolean);
  return { valid, checks, note: rec ? undefined : 'Passport not found (it may have been deleted at the rider\'s request).' };
}

export function latestPassport(userId: string): Row | undefined {
  return one('SELECT * FROM passports WHERE user_id = ? ORDER BY issued_at DESC LIMIT 1', userId);
}
export const signingKey = () => publicKeyPem;
export function passportHistory(userId: string): Row[] { return all('SELECT id, issued_at FROM passports WHERE user_id = ? ORDER BY issued_at DESC', userId); }
