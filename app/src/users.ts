import { one, run, all, type Row } from './db.ts';
import { encrypt, decrypt, lookupHash } from './crypto.ts';
import { uid, nowIso, normalisePhone } from './util.ts';
import type { Lang } from './i18n.ts';

export type User = Row & {
  id: string; role: 'rider' | 'owner'; lang: Lang; channel: 'whatsapp' | 'web'; status: string; state: string;
  vehicle: string | null; ownership: string | null; daily_remit: number | null; owner_id: string | null;
};

export function findByPhone(phone: string): User | undefined {
  return one('SELECT * FROM users WHERE phone_hash = ?', lookupHash(phone)) as User | undefined;
}
export function getUser(id: string): User | undefined {
  return one('SELECT * FROM users WHERE id = ?', id) as User | undefined;
}
export function phoneOf(u: Row): string { return decrypt(u.phone_enc) ?? ''; }
export function nameOf(u: Row): string { return decrypt(u.name_enc) ?? ''; }

export function createUser(phone: string, fields: { role?: string; channel?: string; lang?: string; status?: string } = {}): User {
  const p = normalisePhone(phone);
  if (!p) throw new Error('invalid phone');
  const id = uid();
  run(`INSERT INTO users (id, phone_hash, phone_enc, role, channel, lang, status, state, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`, id, lookupHash(p), encrypt(p), fields.role ?? 'rider', fields.channel ?? 'whatsapp',
      fields.lang ?? 'en', fields.status ?? 'active', 'new', nowIso());
  return getUser(id)!;
}
export function findOrCreate(phone: string, channel: 'whatsapp' | 'web'): User {
  const p = normalisePhone(phone);
  if (!p) throw new Error('invalid phone');
  return findByPhone(p) ?? createUser(p, { channel });
}

export function setState(id: string, state: string, data: unknown = null): void {
  run('UPDATE users SET state = ?, state_data = ? WHERE id = ?', state, data == null ? null : JSON.stringify(data), id);
}
export function stateData<T = any>(u: Row): T | null { return u.state_data ? JSON.parse(u.state_data) as T : null; }

const UPDATABLE = new Set(['lang', 'channel', 'status', 'vehicle', 'ownership', 'daily_remit', 'owner_id', 'pin_hash',
  'voice_research_opt_in', 'verified_owner', 'reminders_off', 'consent_version', 'consent_at', 'onboarded_day', 'last_inbound_at', 'last_active_day', 'logs_count', 'rated', 'role']);
export function update(id: string, fields: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(fields)) {
    if (!UPDATABLE.has(k)) throw new Error('bad field ' + k);
    run(`UPDATE users SET ${k} = ? WHERE id = ?`, v as any, id);
  }
}
export function setName(id: string, name: string): void { run('UPDATE users SET name_enc = ? WHERE id = ?', encrypt(name), id); }

/** NDPA right to erasure: remove personal data and ledger; keep anonymous interaction counts for metrics. */
export function eraseUser(id: string): void {
  run('DELETE FROM entries WHERE user_id = ?', id);
  run('DELETE FROM attestations WHERE rider_id = ? OR owner_id = ?', id, id);
  run('DELETE FROM grants WHERE user_id = ?', id);
  run('DELETE FROM share_codes WHERE user_id = ?', id);
  run('DELETE FROM passports WHERE user_id = ?', id);
  run('DELETE FROM feedback WHERE user_id = ?', id);
  run('DELETE FROM ev_leads WHERE user_id = ?', id);
  run('DELETE FROM web_outbox WHERE user_id = ?', id);
  run('DELETE FROM web_sessions WHERE user_id = ?', id);
  run(`UPDATE interactions SET text = NULL, transcript = NULL, extracted = NULL WHERE user_id = ?`, id);
  run(`UPDATE users SET phone_hash = ?, phone_enc = '', name_enc = NULL, pin_hash = NULL, owner_id = NULL, state = 'erased',
       state_data = NULL, status = 'deleted' WHERE id = ?`, 'deleted:' + id, id);
}

export function activeUserCount(days = 30): number {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return (one(`SELECT COUNT(*) c FROM users WHERE role = 'rider' AND status = 'active' AND consent_at IS NOT NULL
               AND (last_inbound_at >= ? OR created_at >= ?)`, since, since)?.c as number) ?? 0;
}
export function ridersOf(ownerId: string): Row[] { return all('SELECT * FROM users WHERE owner_id = ?', ownerId); }
