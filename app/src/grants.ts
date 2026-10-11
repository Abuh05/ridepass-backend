// Consent records, lender/lessor access grants, share codes and access audit log (NDPA 2023).
import { all, one, run } from './db.ts';
import { config } from './config.ts';
import { uid, nowIso, addDays, lagosDay } from './util.ts';
import { sha256 } from './crypto.ts';
import { randomInt } from 'node:crypto';

export const CONSENT_VERSION = '2026-09-v1';

export function recordConsent(userId: string, kind: string, granted: boolean, evidence: unknown): void {
  run('INSERT INTO consents (id, user_id, kind, version, granted, evidence, created_at) VALUES (?,?,?,?,?,?,?)',
    uid(), userId, kind, CONSENT_VERSION, granted ? 1 : 0, JSON.stringify(evidence ?? null), nowIso());
}

export function requestGrant(orgId: string, userId: string, scope: 'passport' | 'portfolio', dailyDue?: number): string {
  const existing = one(`SELECT id FROM grants WHERE org_id = ? AND user_id = ? AND scope = ? AND status IN ('pending','granted')`, orgId, userId, scope);
  if (existing) return existing.id as string;
  const id = uid();
  run('INSERT INTO grants (id, org_id, user_id, scope, status, daily_due, created_at) VALUES (?,?,?,?,?,?,?)',
    id, orgId, userId, scope, 'pending', dailyDue ?? null, nowIso());
  return id;
}
export function decideGrant(grantId: string, allow: boolean): void {
  const g = one('SELECT * FROM grants WHERE id = ?', grantId);
  if (!g || g.status !== 'pending') return;
  const expires = g.scope === 'passport' ? addDays(lagosDay(), 30) : null;
  run('UPDATE grants SET status = ?, decided_at = ?, expires_at = ? WHERE id = ?', allow ? 'granted' : 'refused', nowIso(), expires, grantId);
  recordConsent(g.user_id as string, `share:${g.scope}:${g.org_id}`, allow, { grantId });
}
export function hasGrant(orgId: string, userId: string, scope: 'passport' | 'portfolio'): boolean {
  const g = one(`SELECT * FROM grants WHERE org_id = ? AND user_id = ? AND scope = ? AND status = 'granted'`, orgId, userId, scope);
  if (!g) return false;
  if (g.expires_at && g.expires_at < lagosDay()) { run(`UPDATE grants SET status = 'expired' WHERE id = ?`, g.id); return false; }
  return true;
}
export function revokeAll(userId: string): number {
  const r = run(`UPDATE grants SET status = 'revoked', decided_at = ? WHERE user_id = ? AND status IN ('pending','granted')`, nowIso(), userId);
  run('DELETE FROM share_codes WHERE user_id = ?', userId);
  recordConsent(userId, 'revoke_all_sharing', false, null);
  return Number(r.changes);
}
export function grantsForOrg(orgId: string, scope?: string) {
  return all(`SELECT * FROM grants WHERE org_id = ? ${scope ? 'AND scope = ?' : ''} ORDER BY created_at DESC`, ...(scope ? [orgId, scope] : [orgId]));
}

// Share codes: 8 chars from an unambiguous alphabet, stored hashed.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newShareCode(userId: string): string {
  const code = Array.from({ length: 8 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
  run('INSERT INTO share_codes (code_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)',
    sha256(code), userId, addDays(lagosDay(), config.shareCodeValidityDays), nowIso());
  return code;
}
export function redeemShareCode(code: string): string | null {
  const r = one('SELECT * FROM share_codes WHERE code_hash = ?', sha256(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')));
  if (!r || r.expires_at < lagosDay()) return null;
  return r.user_id as string;
}

export function logAccess(orgId: string | null, userId: string, action: string, detail?: unknown): void {
  run('INSERT INTO access_log (id, org_id, user_id, action, detail, at) VALUES (?,?,?,?,?,?)', uid(), orgId, userId, action, detail ? JSON.stringify(detail) : null, nowIso());
}
