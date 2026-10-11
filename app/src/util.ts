import { randomBytes, randomUUID } from 'node:crypto';

export const uid = (): string => randomUUID();
export const token = (bytes = 24): string => randomBytes(bytes).toString('base64url');
export const nowIso = (): string => new Date().toISOString();

// Nigeria is UTC+1 all year (no DST).
export function lagosDay(offsetDays = 0, at = Date.now()): string {
  return new Date(at + 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
}
export function addDays(day: string, d: number): string {
  return new Date(Date.parse(day) + d * 86400_000).toISOString().slice(0, 10);
}

export const naira = (n: number): string => '₦' + Math.round(n).toLocaleString('en-NG');

/** Normalise Nigerian phone numbers to 234XXXXXXXXXX. Returns null if invalid. */
export function normalisePhone(raw: string): string | null {
  let d = String(raw).replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  if (d.length === 10 && /^[789]/.test(d)) d = '234' + d;
  if (/^234[789]\d{9}$/.test(d)) return d;
  if (/^\d{8,15}$/.test(d) && !d.startsWith('0')) return d; // allow diaspora/test numbers
  return null;
}

/** Deterministic JSON (sorted keys) for hashing and signatures. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
