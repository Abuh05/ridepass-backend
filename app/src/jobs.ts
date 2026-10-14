// Persistent job queue in SQLite: survives restarts, retries with back-off, per-user ordering.
import { all, one, run } from './db.ts';
import { config } from './config.ts';
import { nowIso, uid } from './util.ts';

type Handler = (payload: any, attempt: number) => Promise<void>;
const handlers = new Map<string, Handler>();
const busyKeys = new Set<string>();
let running = 0;
let timer: NodeJS.Timeout | null = null;
const backoffMs = (attempt: number) => Math.min(600_000, 2 ** attempt * 2000);
/** Attempts needed for the back-off schedule to cover `hours` (exponential up to 10 min, then every 10 min). */
export function attemptsFor(hours: number): number {
  let elapsed = 0, n = 0;
  while (elapsed < hours * 3600_000) elapsed += backoffMs(++n);
  return n;
}
// Voice notes wait out GPU downtime (pod stopped overnight, restarts). Default 24 h, so a note sent
// outside the GPU's daily hours is still answered the next morning. INBOUND_RETRY_HOURS to change.
export const INBOUND_MAX_ATTEMPTS = attemptsFor(Number(process.env.INBOUND_RETRY_HOURS ?? 24));
const MAX_ATTEMPTS: Record<string, number> = { inbound: INBOUND_MAX_ATTEMPTS, wa_send: 6 };

export function registerHandler(kind: string, fn: Handler): void { handlers.set(kind, fn); }

export function enqueue(kind: string, payload: unknown, lockKey: string | null = null, delayMs = 0): string {
  const id = uid();
  run('INSERT INTO jobs (id, kind, lock_key, payload, run_at, created_at) VALUES (?,?,?,?,?,?)',
    id, kind, lockKey, JSON.stringify(payload), Date.now() + delayMs, nowIso());
  setImmediate(tick);
  return id;
}

async function runJob(job: any): Promise<void> {
  const h = handlers.get(job.kind);
  running++;
  if (job.lock_key) busyKeys.add(job.lock_key);
  try {
    if (!h) throw new Error('no handler for ' + job.kind);
    await h(JSON.parse(job.payload), job.attempts + 1);
    run(`UPDATE jobs SET status = 'done' WHERE id = ?`, job.id);
  } catch (e) {
    const attempts = job.attempts + 1;
    const dead = attempts >= (MAX_ATTEMPTS[job.kind] ?? 5) || (e as any)?.permanent;
    run(`UPDATE jobs SET status = ?, attempts = ?, run_at = ?, last_error = ? WHERE id = ?`,
      dead ? 'failed' : 'queued', attempts, Date.now() + backoffMs(attempts), String((e as Error)?.stack ?? e).slice(0, 2000), job.id);
    console.error(`[jobs] ${job.kind} ${job.id} attempt ${attempts} failed:`, (e as Error)?.message);
  } finally {
    running--;
    if (job.lock_key) busyKeys.delete(job.lock_key);
    setImmediate(tick);
  }
}

function tick(): void {
  if (running >= config.workerConcurrency) return;
  const due = all(`SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at, created_at LIMIT 50`, Date.now());
  for (const job of due) {
    if (running >= config.workerConcurrency) break;
    // per-user ordering: never run two jobs for the same user at once, and never overtake an older one
    if (job.lock_key && (busyKeys.has(job.lock_key) ||
      one(`SELECT 1 FROM jobs WHERE lock_key = ? AND status = 'queued' AND created_at < ? AND id != ?`, job.lock_key, job.created_at, job.id))) continue;
    const claimed = run(`UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'queued'`, job.id);
    if (Number(claimed.changes) === 1) void runJob(job);
  }
}

export function startWorker(): void {
  run(`UPDATE jobs SET status = 'queued' WHERE status = 'running'`); // recover after crash/restart
  timer = setInterval(tick, 500);
}
export function stopWorker(): void { if (timer) clearInterval(timer); timer = null; }

/** Tests/scripts: run queued jobs until the queue is empty. */
export async function drain(maxRounds = 200): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    const job = one(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`);
    if (!job) { if (running === 0) return; await new Promise((r) => setTimeout(r, 5)); continue; }
    run(`UPDATE jobs SET status = 'running', run_at = 0 WHERE id = ?`, job.id);
    await runJob(job);
  }
}
export function queueStats() {
  return all(`SELECT kind, status, COUNT(*) n FROM jobs GROUP BY kind, status`);
}
