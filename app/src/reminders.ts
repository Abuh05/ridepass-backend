// Evening reminder to riders who haven't logged today. Outside WhatsApp's 24-hour window this needs
// the approved template `ridepass_daily_reminder`; without it, those riders are skipped (never spammed).
import { all, one, run } from './db.ts';
import { config } from './config.ts';
import { lagosDay } from './util.ts';
import { t } from './i18n.ts';
import { getUser, nameOf, type User } from './users.ts';
import { send, withinWhatsAppWindow } from './channels/send.ts';

const HOUR = Number(process.env.REMINDER_HOUR_LAGOS ?? 19);

export function sendReminders(today = lagosDay()): { sent: number; skipped: number } {
  const rows = all(`SELECT id FROM users WHERE role = 'rider' AND status = 'active' AND state = 'active' AND consent_at IS NOT NULL AND reminders_off = 0
                    AND (last_active_day IS NULL OR last_active_day < ?)`, today);
  let sent = 0, skipped = 0;
  for (const r of rows) {
    const u = getUser(r.id as string) as User;
    const name = nameOf(u).split(' ')[0] || '';
    if (u.channel === 'web' || withinWhatsAppWindow(u)) { send(u, { text: t(u.lang, 'reminder', { name }) }); sent++; }
    else if (config.wa.approvedTemplates.has('ridepass_daily_reminder')) {
      send(u, { text: t(u.lang, 'reminder', { name }), template: { name: 'ridepass_daily_reminder', params: [name] } }); sent++;
    } else skipped++;
  }
  return { sent, skipped };
}

export function startReminderClock(): NodeJS.Timeout {
  return setInterval(() => {
    const lagosHour = (new Date().getUTCHours() + 1) % 24;
    const today = lagosDay();
    if (lagosHour !== HOUR) return;
    if (one(`SELECT 1 FROM kv WHERE k = 'reminders_sent' AND v = ?`, today)) return;
    run(`INSERT INTO kv (k, v) VALUES ('reminders_sent', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, today);
    const r = sendReminders(today);
    console.log(`[reminders] ${today}: sent ${r.sent}, skipped ${r.skipped} (no template)`);
  }, 60_000);
}
