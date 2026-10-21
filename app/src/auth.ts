import { one, run } from './db.ts';
import { config } from './config.ts';
import { checkSecret, hashSecret, safeEqual, sha256 } from './crypto.ts';
import { HttpError, type Req } from './http.ts';
import { token, uid, nowIso } from './util.ts';

export function requireAdmin(req: Req): void {
  const k = String(req.headers['x-admin-key'] ?? '');
  if (!config.adminApiKey || !k || !safeEqual(k, config.adminApiKey)) throw new HttpError(401, 'admin key required');
}

/** Org API keys look like rp_<prefix>_<secret>; only a scrypt hash is stored. */
export function createOrg(name: string, kind: 'lessor' | 'lender' | 'agent'): { id: string; apiKey: string } {
  const id = uid();
  const prefix = token(6).replace(/[-_]/g, 'x').slice(0, 8);
  const secret = token(24);
  run('INSERT INTO orgs (id, name, kind, api_key_hash, key_prefix, created_at) VALUES (?,?,?,?,?,?)', id, name, kind, hashSecret(secret), prefix, nowIso());
  return { id, apiKey: `rp_${prefix}_${secret}` };
}
export function requireOrg(req: Req, kinds: string[]): { id: string; name: string; kind: string } {
  const key = String(req.headers['x-api-key'] ?? '');
  const m = key.match(/^rp_([A-Za-z0-9]{8})_(.+)$/);
  if (!m) throw new HttpError(401, 'API key required');
  const org = one('SELECT * FROM orgs WHERE key_prefix = ?', m[1]);
  if (!org) throw new HttpError(401, 'invalid API key');
  if (!checkSecret(m[2], org.api_key_hash as string)) { logOrgUse(req, org.id as string, 'Wrong key entered', false); throw new HttpError(401, 'invalid API key'); }
  if (!kinds.includes(org.kind as string)) { logOrgUse(req, org.id as string, 'Used the key in the wrong app', false); throw new HttpError(403, `this key is for a ${org.kind}`); }
  logOrgUse(req, org.id as string);
  return { id: org.id as string, name: org.name as string, kind: org.kind as string };
}

const ORG_ACTIONS: Record<string, string> = {
  'GET /api/org/me': 'Signed in',
  'POST /api/agent/rider': 'Opened a rider',
  'POST /api/agent/message': 'Sent a message for a rider',
  'POST /api/agent/voice': 'Sent a voice note',
  'POST /api/agent/verify-owner': 'Verified an owner',
  'POST /api/org/grants': 'Asked a rider for access',
  'GET /api/org/grants': 'Viewed access requests',
  'GET /api/org/grants/:id/passport': 'Viewed a passport',
  'POST /api/org/share-code': 'Opened a passport share code',
  'GET /api/org/portfolio': 'Viewed the portfolio',
};
// The agent app polls these every few seconds; recording them would bury the real actions.
const POLLED = new Set(['GET /api/agent/outbox', 'GET /api/agent/rider']);

/** Records each use of an org key so the admin console can show who signed in and what they did. */
function logOrgUse(req: Req, orgId: string, failure?: string, ok = true): void {
  const route = `${req.method} ${(req.url ?? '').split('?')[0].replace(/\/grants\/[^/]+\/passport$/, '/grants/:id/passport')}`;
  if (POLLED.has(route)) return;
  const action = ok ? ORG_ACTIONS[route] ?? route : `${failure} (${ORG_ACTIONS[route] ?? route})`;
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim().slice(0, 64);
  run('INSERT INTO org_activity (org_id, action, ok, ip, at) VALUES (?,?,?,?,?)', orgId, action, ok ? 1 : 0, ip || null, nowIso());
}

export function newSession(kind: 'rider', userId: string, hours = 12): string {
  const tok = token(24);
  run('INSERT INTO web_sessions (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)', sha256(tok), userId, kind, new Date(Date.now() + hours * 3600_000).toISOString());
  return tok;
}
export function sessionUser(req: Req, kind: string): string {
  const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const s = auth && one('SELECT * FROM web_sessions WHERE token_hash = ? AND kind = ?', sha256(auth), kind);
  if (!s || s.expires_at < nowIso()) throw new HttpError(401, 'please log in again');
  return s.user_id as string;
}
