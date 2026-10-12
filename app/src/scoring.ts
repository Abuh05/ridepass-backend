// RidePass Score (0–100) — transparent, behaviour-only, explainable.
// Deliberately EXCLUDES language, gender, ethnicity, religion, location and age (N-ATLAS licence bans
// discriminatory profiling; NDPA fairness). Every score ships with plain-language reasons.
import { all, one } from './db.ts';
import { config } from './config.ts';
import { liveEntries } from './ledger.ts';
import { addDays, clamp, daysBetween, lagosDay, mean, stdev } from './util.ts';
import { EXPENSE_TYPES, REPAYMENT_TYPES } from './nlu/keywords.ts';
import type { Row } from './db.ts';

/** Owner answers that prove the owner themselves replied (see AttestVia in attest.ts). */
export const COUNTED_VIA: readonly string[] = ['whatsapp', 'web_pin'];

export type DayAgg = { day: string; income: number; expenses: number; repaid: number; repaidConfirmed: number; savings: number; flags: number };
export type ScoreResult = {
  status: 'building' | 'scored';
  score: number | null; band: string | null;
  components: Record<string, { points: number; max: number; value: number }>;
  reasons: { positive: string[]; negative: string[] };
  stats: {
    window_days: number; active_days: number; logging_regularity: number;
    avg_daily_income: number; avg_daily_expenses: number; avg_daily_repayment: number; avg_daily_net_before_repayment: number;
    total_repaid: number; total_repaid_confirmed: number; verified_repayment_pct: number; disputed_payments: number; flagged_entries: number;
    income_stability: number; member_since: string; tenure_days: number; owner_verified: boolean;
    // How the window's entries were recorded (shown to lenders; not used in the score).
    recorded_voice_pct: number; recorded_typed_pct: number; recorded_with_agent_pct: number;
  };
};

const WINDOW = 60;

export function dailyAggregates(userId: string, from: string, to: string): DayAgg[] {
  const rows = liveEntries(userId, from, to);
  // A payment counts as owner-confirmed only when the owner provably answered (own WhatsApp number or PIN).
  const att = new Map(all(`SELECT a.entry_id, a.status, a.via FROM attestations a WHERE a.rider_id = ?`, userId)
    .map((r) => [r.entry_id, r.status === 'confirmed' && !COUNTED_VIA.includes(r.via) ? 'confirmed_unverified' : r.status]));
  const map = new Map<string, DayAgg>();
  for (const r of rows) {
    const d = map.get(r.day) ?? { day: r.day, income: 0, expenses: 0, repaid: 0, repaidConfirmed: 0, savings: 0, flags: 0 };
    if (r.type === 'income') d.income += r.amount;
    else if ((EXPENSE_TYPES as string[]).includes(r.type)) d.expenses += r.amount;
    else if ((REPAYMENT_TYPES as string[]).includes(r.type)) {
      d.repaid += r.amount;
      if (att.get(r.id) === 'confirmed') d.repaidConfirmed += r.amount;
    } else if (r.type === 'savings') d.savings += r.amount;
    if (JSON.parse(r.flags || '[]').length) d.flags += 1;
    map.set(r.day, d);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function band(score: number): string {
  return score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'E';
}

export function computeScore(user: Row, today = lagosDay()): ScoreResult {
  const memberSince: string = user.onboarded_day ?? String(user.created_at).slice(0, 10);
  const tenure = Math.max(1, daysBetween(memberSince, today) + 1);
  const windowDays = Math.min(WINDOW, tenure);
  const from = addDays(today, -(windowDays - 1));
  const days = dailyAggregates(user.id, from, today);
  const active = days.filter((d) => d.income > 0 || d.expenses > 0 || d.repaid > 0);
  const totalRepaid = days.reduce((a, d) => a + d.repaid, 0);
  const totalConfirmed = days.reduce((a, d) => a + d.repaidConfirmed, 0);
  const disputed = (one(`SELECT COUNT(*) c FROM attestations WHERE rider_id = ? AND status = 'disputed'`, user.id)?.c as number) ?? 0;
  const flagged = days.reduce((a, d) => a + d.flags, 0);
  const netBefore = active.map((d) => d.income - d.expenses);
  // The entry source (voice | text | agent) is part of each entry's hash, so this breakdown is tamper-evident.
  const bySource = new Map(all(`SELECT source, COUNT(*) n FROM entries WHERE user_id = ? AND type != 'void' AND day >= ? AND day <= ? GROUP BY source`, user.id, from, today)
    .map((r) => [r.source as string, r.n as number]));
  const recorded = [...bySource.values()].reduce((a, n) => a + n, 0);
  const pct = (k: string) => (recorded ? Math.round(((bySource.get(k) ?? 0) / recorded) * 100) : 0);
  const stability = active.length >= 3 && mean(netBefore) > 0 ? clamp(1 - stdev(netBefore) / mean(netBefore)) : 0;

  const stats: ScoreResult['stats'] = {
    window_days: windowDays,
    active_days: active.length,
    logging_regularity: +(active.length / windowDays).toFixed(2),
    avg_daily_income: Math.round(mean(active.map((d) => d.income))),
    avg_daily_expenses: Math.round(mean(active.map((d) => d.expenses))),
    avg_daily_repayment: Math.round(mean(active.map((d) => d.repaid))),
    avg_daily_net_before_repayment: Math.round(mean(netBefore)),
    total_repaid: totalRepaid,
    total_repaid_confirmed: totalConfirmed,
    verified_repayment_pct: totalRepaid ? Math.round((totalConfirmed / totalRepaid) * 100) : 0,
    disputed_payments: disputed,
    flagged_entries: flagged,
    income_stability: +stability.toFixed(2),
    member_since: memberSince,
    tenure_days: tenure,
    owner_verified: user.owner_id ? Boolean(one('SELECT verified_owner FROM users WHERE id = ?', user.owner_id)?.verified_owner) : false,
    recorded_voice_pct: pct('voice'),
    recorded_typed_pct: pct('text'),
    recorded_with_agent_pct: pct('agent'),
  };

  const empty = { status: 'building' as const, score: null, band: null, components: {}, reasons: { positive: [], negative: [] }, stats };
  if (active.length < config.minScoreDays) return empty;

  const hasObligation = user.ownership === 'hire_purchase' || user.ownership === 'daily_rent';
  const due = Number(user.daily_remit) || 0;
  // Repayment reliability: share of active days where the rider paid ≥ 90% of the agreed daily amount.
  const paidDays = active.filter((d) => (due ? d.repaid >= 0.9 * due : d.repaid > 0)).length;
  const repayment = hasObligation ? paidDays / active.length : clamp(active.filter((d) => d.savings > 0).length / active.length * 2);
  // Confirmations from an owner verified by a registered lessor or field agent count in full;
  // a self-declared owner's confirmations count 80% (limits "friend as fake owner" collusion).
  const ownerVerified = user.owner_id ? Boolean(one('SELECT verified_owner FROM users WHERE id = ?', user.owner_id)?.verified_owner) : false;
  const verification = hasObligation
    ? clamp(((totalRepaid ? totalConfirmed / totalRepaid : 0) - disputed * 0.1) * (ownerVerified ? 1 : 0.8))
    : 0.4; // own-vehicle riders have no counter-party yet; neutral-low until agent/bank verification exists
  const avgIncome = mean(active.map((d) => d.income));
  const headroom = avgIncome > 0 ? clamp((avgIncome - mean(active.map((d) => d.expenses)) - mean(active.map((d) => d.repaid))) / avgIncome / 0.4) : 0;

  const C = {
    consistency: { max: 25, value: stats.logging_regularity },
    repayment: { max: 25, value: repayment },
    stability: { max: 20, value: stability },
    verification: { max: 15, value: verification },
    affordability: { max: 10, value: headroom },
    tenure: { max: 5, value: clamp(tenure / 90) },
  };
  const components: ScoreResult['components'] = {};
  let total = 0;
  for (const [k, c] of Object.entries(C)) {
    const pts = +(c.max * clamp(c.value)).toFixed(1);
    components[k] = { points: pts, max: c.max, value: +c.value.toFixed(2) };
    total += pts;
  }
  const penalty = Math.min(15, flagged * 3);
  components.anomaly_penalty = { points: -penalty, max: 0, value: flagged };
  const score = Math.round(clamp(total - penalty, 0, 100));

  const pos: string[] = [], neg: string[] = [];
  if (C.consistency.value >= 0.8) pos.push(`Logs money almost every day (${active.length}/${windowDays} days)`);
  else if (C.consistency.value < 0.5) neg.push(`Irregular record keeping (${active.length}/${windowDays} days logged)`);
  if (hasObligation) {
    if (repayment >= 0.85) pos.push(`Paid the owner/lender on ${paidDays} of ${active.length} working days`);
    else neg.push(`Missed or short payments on ${active.length - paidDays} of ${active.length} working days`);
    if (verification >= 0.7) pos.push(`${stats.verified_repayment_pct}% of repayments confirmed by the owner`);
    else neg.push(`Only ${stats.verified_repayment_pct}% of repayments confirmed by a third party`);
  } else neg.push('Owns vehicle outright: no third-party repayment confirmations yet');
  if (stability >= 0.6) pos.push('Stable daily earnings');
  else if (stability < 0.3) neg.push('Earnings vary a lot from day to day');
  if (headroom >= 0.6) pos.push(`Healthy margin: about ₦${stats.avg_daily_net_before_repayment.toLocaleString('en-NG')}/day before repayments`);
  else if (headroom < 0.25) neg.push('Little money left after costs and repayments');
  if (disputed) neg.push(`${disputed} payment(s) disputed by the owner`);
  if (flagged) neg.push(`${flagged} day(s) with unusual entries flagged for review`);

  return { status: 'scored', score, band: band(score), components, reasons: { positive: pos, negative: neg }, stats };
}

/** Can the rider afford a proposed daily repayment? (for lenders) */
export function affordability(result: ScoreResult, proposedDaily: number, replacesCurrentRepayment = false): { verdict: 'affordable' | 'stretch' | 'unaffordable' | 'insufficient_data'; max_recommended_daily: number } {
  // If the new facility replaces the current owner/hire-purchase payment (e.g. refinancing into an EV lease),
  // the current repayment is freed up; otherwise it must still be paid.
  const net = result.stats.avg_daily_net_before_repayment - (replacesCurrentRepayment ? 0 : result.stats.avg_daily_repayment);
  if (result.stats.active_days < config.minScoreDays || net <= 0) return { verdict: 'insufficient_data', max_recommended_daily: 0 };
  const max = Math.round(net * 0.5); // keep at least half the margin for the rider's household
  return { verdict: proposedDaily <= max ? 'affordable' : proposedDaily <= net * 0.7 ? 'stretch' : 'unaffordable', max_recommended_daily: max };
}
