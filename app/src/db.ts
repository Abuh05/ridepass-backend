// SQLite via Node's built-in driver (node:sqlite). WAL mode; fine for a pilot of up to the
// 1,000-user N-ATLAS licence cap on a single server. Swap for Postgres when scaling.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone_hash TEXT UNIQUE NOT NULL,
  phone_enc TEXT NOT NULL,
  name_enc TEXT,
  role TEXT NOT NULL DEFAULT 'rider',          -- rider | owner
  lang TEXT NOT NULL DEFAULT 'en',             -- en | pcm | ha | yo | ig
  channel TEXT NOT NULL DEFAULT 'whatsapp',    -- whatsapp | web
  status TEXT NOT NULL DEFAULT 'active',       -- active | waitlist | declined | deleted
  state TEXT NOT NULL DEFAULT 'new',
  state_data TEXT,
  vehicle TEXT,                                -- keke | okada | bus | car
  ownership TEXT,                              -- own | hire_purchase | daily_rent
  daily_remit INTEGER,
  owner_id TEXT,
  pin_hash TEXT,
  voice_research_opt_in INTEGER NOT NULL DEFAULT 0,
  verified_owner INTEGER NOT NULL DEFAULT 0,
  reminders_off INTEGER NOT NULL DEFAULT 0,       -- owner phone confirmed by a registered lessor / field agent
  consent_version TEXT,
  consent_at TEXT,
  onboarded_day TEXT,
  last_inbound_at TEXT,
  last_active_day TEXT,
  logs_count INTEGER NOT NULL DEFAULT 0,
  rated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, version TEXT NOT NULL,
  granted INTEGER NOT NULL, evidence TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL,          -- income|fuel|charging|owner_payment|loan_repayment|repair|levy|savings|other_expense|void
  amount INTEGER NOT NULL,
  ref TEXT,                    -- for void: id of voided entry
  source TEXT NOT NULL,        -- voice | text | agent
  agent_id TEXT,
  interaction_id TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, seq)
);
CREATE INDEX IF NOT EXISTS entries_user_day ON entries(user_id, day);
CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, rider_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|disputed|expired
  via TEXT, created_at TEXT NOT NULL, responded_at TEXT
);
CREATE INDEX IF NOT EXISTS att_owner ON attestations(owner_id, status);
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, -- lessor | lender | agent
  api_key_hash TEXT NOT NULL, key_prefix TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
  scope TEXT NOT NULL,          -- passport | portfolio
  status TEXT NOT NULL,         -- pending | granted | refused | revoked | expired
  daily_due INTEGER, expires_at TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS access_log (
  id TEXT PRIMARY KEY, org_id TEXT, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_activity (    -- every use of an org API key (sign-ins, actions, rejected keys)
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, action TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 1, ip TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS org_activity_org ON org_activity(org_id, at);
CREATE TABLE IF NOT EXISTS share_codes (
  code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passports (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, signature TEXT NOT NULL, issued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,     -- in | out
  kind TEXT NOT NULL,          -- text | audio | button | system
  lang TEXT,
  text TEXT,
  transcript TEXT,
  audio_seconds REAL,
  asr_ms INTEGER, llm_ms INTEGER,
  asr_model TEXT,
  model_path TEXT,             -- natlas | natlas_guarded | fallback | keyword | mock | none
  intent TEXT,
  extracted TEXT,
  outcome TEXT,                -- confirmed | corrected | cancelled
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inter_user ON interactions(user_id, created_at);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, lock_key TEXT, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  run_at INTEGER NOT NULL, last_error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS web_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT, org_id TEXT, kind TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rating INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner_pin_failures (owner_id TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS anchors (day TEXT PRIMARY KEY, root TEXT NOT NULL, riders INTEGER NOT NULL, leaves TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pin_fail_owner ON owner_pin_failures(owner_id, at);
CREATE TABLE IF NOT EXISTS ev_leads (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, estimate TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

export type Row = Record<string, any>;

function open(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  d.exec(SCHEMA);
  return d;
}

export let db: DatabaseSync = open(process.env.NODE_TEST ? ':memory:' : config.dbPath);

/** Tests: swap in a fresh in-memory database. */
export function resetDbForTests(): void {
  db = open(':memory:');
}

export const one = (sql: string, ...p: any[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
export const all = (sql: string, ...p: any[]): Row[] => db.prepare(sql).all(...p) as Row[];
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
