// EV-switch calculator: turns the rider's OWN logged fuel spend into an electric-conversion estimate.
import { config } from './config.ts';
import { liveEntries } from './ledger.ts';
import { addDays, lagosDay, mean } from './util.ts';

export type EvEstimate = { vehicle: string; days: number; fuelPerDay: number; kmPerDay: number; elecPerDay: number; savingPerMonth: number; paybackMonths: number | null };

export function evEstimate(userId: string, vehicle: string | null): EvEstimate | null {
  const v = vehicle && config.ev.kmPerLitre[vehicle] ? vehicle : 'keke';
  const rows = liveEntries(userId, addDays(lagosDay(), -29), lagosDay()).filter((r) => r.type === 'fuel');
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.amount);
  if (byDay.size < 3) return null;
  const fuelPerDay = mean([...byDay.values()]);
  const litres = fuelPerDay / config.ev.petrolPricePerLitre;
  const kmPerDay = litres * config.ev.kmPerLitre[v];
  const elecPerDay = kmPerDay * config.ev.kwhPerKm[v] * config.ev.electricityPricePerKwh;
  const savingPerMonth = (fuelPerDay - elecPerDay) * config.ev.workingDaysPerMonth;
  const paybackMonths = savingPerMonth > 0 ? Math.ceil(config.ev.conversionCost[v] / savingPerMonth) : null;
  return { vehicle: v, days: byDay.size, fuelPerDay: Math.round(fuelPerDay), kmPerDay: Math.round(kmPerDay), elecPerDay: Math.round(elecPerDay), savingPerMonth: Math.round(savingPerMonth), paybackMonths };
}
