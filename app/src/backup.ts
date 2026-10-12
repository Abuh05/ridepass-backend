// Database backups. A consistent snapshot (SQLite VACUUM INTO) is written to DATA_DIR/backups every
// day at 02:00 Lagos time, and the last BACKUP_KEEP_DAYS daily files are kept. Admins can also
// download a fresh snapshot (GET /api/admin/backup) to keep a copy off the server.
// Names and phone numbers inside are AES-encrypted; the snapshot is useless without DATA_KEY.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.ts';
import { config } from './config.ts';
import { lagosDay, uid } from './util.ts';

const KEEP = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const DAILY = /^ridepass-\d{4}-\d{2}-\d{2}\.db$/;
export const backupDir = (): string => join(config.dataDir, 'backups');

/** Write a consistent copy of the live database to `file` (overwrites). */
export function snapshotTo(file: string): void {
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/** Today's daily backup, then prune old daily backups (other files, e.g. pre-reset copies, are kept). */
export function dailyBackup(day = lagosDay(), keep = KEEP): { file: string; pruned: string[] } {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ridepass-${day}.db`);
  snapshotTo(file);
  const daily = readdirSync(dir).filter((f) => DAILY.test(f)).sort();
  const pruned = daily.slice(0, Math.max(0, daily.length - keep));
  for (const f of pruned) rmSync(join(dir, f), { force: true });
  return { file, pruned };
}

export function listBackups(): { file: string; bytes: number; created_at: string }[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => {
    const s = statSync(join(dir, f));
    return { file: f, bytes: s.size, created_at: s.mtime.toISOString() };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A fresh snapshot in a temporary file, for download. The caller deletes it. */
export function freshSnapshot(): string {
  const dir = join(config.dataDir, 'tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `backup-${uid()}.db`);
  snapshotTo(file);
  return file;
}

/** Daily at 02:00 Lagos time (UTC+1); also makes one at start-up if today's is missing after 02:00. */
export function startBackupClock(): NodeJS.Timeout {
  const tick = () => {
    if ((new Date().getUTCHours() + 1) % 24 < 2) return;
    if (existsSync(join(backupDir(), `ridepass-${lagosDay()}.db`))) return;
    try { const r = dailyBackup(); console.log(`[backup] ${r.file}${r.pruned.length ? `; pruned ${r.pruned.join(', ')}` : ''}`); }
    catch (e) { console.error('[backup] failed:', (e as Error).message); }
  };
  tick();
  return setInterval(tick, 60 * 60_000);
}
