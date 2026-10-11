// Plausibility checks run before entries are committed. Flags are stored in the hash-chained entry
// and shown to lenders; they also reduce the verification component of the score.
import { all } from './db.ts';
import { config } from './config.ts';
import { median } from './util.ts';
import type { Draft } from './nlu/fallback.ts';

export type Flag = 'outlier_high' | 'implausible_amount' | 'possible_duplicate' | 'backfill_burst' | 'fuel_exceeds_income';

export function checkDrafts(userId: string, vehicle: string | null, day: string, drafts: Draft[]): Flag[][] {
  const recent = all(`SELECT type, amount, day, created_at FROM entries WHERE user_id = ? AND type != 'void' AND day >= date(?, '-60 day')`, userId, day);
  const incomeByDay = new Map<string, number>();
  for (const r of recent) if (r.type === 'income') incomeByDay.set(r.day, (incomeByDay.get(r.day) ?? 0) + r.amount);
  const med = median([...incomeByDay.values()]);
  const cap = config.maxDailyIncome[vehicle ?? 'keke'] ?? config.maxDailyIncome.keke;
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const recentBurst = recent.filter((r) => r.created_at >= tenMinAgo && r.day !== day).length;
  const dayIncome = (incomeByDay.get(day) ?? 0) + drafts.filter((d) => d.type === 'income').reduce((a, d) => a + d.amount, 0);
  const dayFuel = recent.filter((r) => r.day === day && r.type === 'fuel').reduce((a, r) => a + r.amount, 0)
    + drafts.filter((d) => d.type === 'fuel').reduce((a, d) => a + d.amount, 0);

  return drafts.map((d) => {
    const f: Flag[] = [];
    if (d.type === 'income') {
      if (dayIncome > cap) f.push('implausible_amount');
      else if (incomeByDay.size >= 7 && d.amount > 4 * med) f.push('outlier_high');
    }
    if (d.type !== 'income' && d.amount > cap * 2) f.push('implausible_amount');
    if (recent.some((r) => r.day === day && r.type === d.type && r.amount === d.amount && r.created_at >= thirtyMinAgo)) f.push('possible_duplicate');
    if (recentBurst >= 6) f.push('backfill_burst');
    if (d.type === 'fuel' && dayIncome > 0 && dayFuel > dayIncome) f.push('fuel_exceeds_income');
    return f;
  });
}
