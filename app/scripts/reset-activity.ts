// Clears all rider activity (riders, owners, ledger, voice-note interactions, passports, grants) while
// keeping the organisations and their API keys. Use it to remove test traffic before a pilot or a
// submission. A backup copy of the database is written first.
//   npm run reset:activity -- --yes
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

if (!process.argv.includes('--yes')) {
  console.error('This deletes all riders, owners and their records (organisations are kept). Re-run with --yes to proceed.');
  process.exit(1);
}
const { db, all, one } = await import('../src/db.ts');
const { config } = await import('../src/config.ts');

const ACTIVITY = ['users', 'consents', 'entries', 'attestations', 'grants', 'access_log', 'share_codes', 'passports', 'interactions',
  'jobs', 'web_outbox', 'web_sessions', 'feedback', 'kv', 'owner_pin_failures', 'ev_leads'];

const backupDir = join(config.dataDir, 'backups');
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `ridepass-before-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log('Backup written:', backup);

const before = Object.fromEntries(ACTIVITY.map((t) => [t, one(`SELECT COUNT(*) c FROM ${t}`)!.c]));
db.exec('BEGIN IMMEDIATE');
for (const t of ACTIVITY) db.exec(`DELETE FROM ${t}`);
db.exec('COMMIT');
for (const dir of ['tmp', 'benchmark']) rmSync(join(config.dataDir, dir), { recursive: true, force: true });

console.log('Removed rows:', before);
console.log('Organisations kept:', all('SELECT name, kind FROM orgs').map((o) => `${o.kind}: ${o.name}`).join(', ') || 'none');
console.log('Backups on disk:', readdirSync(backupDir).length);
