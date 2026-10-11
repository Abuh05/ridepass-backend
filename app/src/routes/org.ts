// Lessor / lender API (x-api-key) and admin API (x-admin-key).
import { config } from '../config.ts';
import { all, one } from '../db.ts';
import { HttpError, sendJson, sendText, type Router } from '../http.ts';
import { requireAdmin, requireOrg, createOrg } from '../auth.ts';
import * as U from '../users.ts';
import { normalisePhone, addDays, lagosDay } from '../util.ts';
import { requestGrant, hasGrant, grantsForOrg, redeemShareCode, logAccess } from '../grants.ts';
import { askRiderForGrant } from '../flow.ts';
import { issuePassport } from '../passport.ts';
import { computeScore, dailyAggregates, affordability } from '../scoring.ts';
import { metrics } from '../interactions.ts';
import { queueStats } from '../jobs.ts';
import { modelHealth } from '../models.ts';
import { sendReminders } from '../reminders.ts';

function riderView(u: U.User) {
  return { first_name: U.nameOf(u).split(' ')[0], vehicle: u.vehicle, ownership: u.ownership, member_since: u.onboarded_day };
}

export function orgRoutes(r: Router): void {
  r.get('/api/org/me', (q, s) => { const o = requireOrg(q, ['lessor', 'lender', 'agent']); sendJson(s, 200, o); });

  // Ask a rider for access (rider approves in WhatsApp/web).
  r.post('/api/org/grants', (q, s) => {
    const org = requireOrg(q, ['lessor', 'lender']);
    const phone = normalisePhone(String(q.json?.phone ?? ''));
    const scope = q.json?.scope === 'portfolio' ? 'portfolio' : 'passport';
    if (scope === 'portfolio' && org.kind !== 'lessor') throw new HttpError(403, 'portfolio tracking is for lessors');
    const u = phone ? U.findByPhone(phone) : undefined;
    if (!u || !u.consent_at || u.role !== 'rider') throw new HttpError(404, 'No RidePass rider with that number. Ask them to message RidePass first.');
    const dailyDue = q.json?.daily_due ? Math.round(Number(q.json.daily_due)) : undefined;
    const grantId = requestGrant(org.id, u.id, scope, dailyDue);
    const delivered = askRiderForGrant(u, grantId, org.name, scope);
    logAccess(org.id, u.id, 'grant_requested', { scope });
    sendJson(s, 201, { grant_id: grantId, status: 'pending', delivered,
      note: delivered ? 'Rider has been asked in their language.' : 'Rider has not messaged in 24h and the access-request template is not approved yet: ask the rider to send "hi" to RidePass, then retry.' });
  });
  r.get('/api/org/grants', (q, s) => {
    const org = requireOrg(q, ['lessor', 'lender']);
    sendJson(s, 200, grantsForOrg(org.id).map((g) => {
      const u = U.getUser(g.user_id as string);
      return { grant_id: g.id, scope: g.scope, status: g.status, daily_due: g.daily_due, created_at: g.created_at, expires_at: g.expires_at, rider: u && u.status !== 'deleted' ? riderView(u) : null };
    }));
  });

  // Passport for a rider who granted access.
  r.get('/api/org/grants/:id/passport', (q, s) => {
    const org = requireOrg(q, ['lessor', 'lender']);
    const g = one('SELECT * FROM grants WHERE id = ? AND org_id = ?', q.params.id, org.id);
    if (!g || !hasGrant(org.id, g.user_id as string, g.scope as 'passport' | 'portfolio')) throw new HttpError(403, 'no active permission from this rider');
    const u = U.getUser(g.user_id as string)!;
    const { payload, signature } = issuePassport(u);
    const proposed = Number(q.query.get('proposed_daily') ?? 0);
    logAccess(org.id, u.id, 'passport_view', { grant: g.id });
    sendJson(s, 200, { payload, signature, affordability: proposed ? affordability(computeScore(u), proposed, q.query.get('replaces_current') === '1') : undefined });
  });

  // Redeem a share code the rider gave in person.
  r.post('/api/org/share-code', (q, s) => {
    const org = requireOrg(q, ['lessor', 'lender']);
    const userId = redeemShareCode(String(q.json?.code ?? ''));
    if (!userId) throw new HttpError(404, 'invalid or expired code');
    const u = U.getUser(userId)!;
    const { payload, signature } = issuePassport(u);
    const proposed = Number(q.json?.proposed_daily ?? 0);
    logAccess(org.id, u.id, 'passport_view_share_code');
    sendJson(s, 200, { payload, signature, affordability: proposed ? affordability(computeScore(u), proposed, !!q.json?.replaces_current) : undefined });
  });

  // Lessor portfolio: daily repayment tracking for riders who granted "portfolio" access.
  r.get('/api/org/portfolio', (q, s) => {
    const org = requireOrg(q, ['lessor']);
    const days = Math.min(30, Number(q.query.get('days') ?? 14));
    const today = lagosDay();
    const from = addDays(today, -(days - 1));
    const out = [];
    for (const g of grantsForOrg(org.id, 'portfolio').filter((g) => g.status === 'granted')) {
      const u = U.getUser(g.user_id as string);
      if (!u || u.status === 'deleted') continue;
      const due = Number(g.daily_due ?? u.daily_remit ?? 0);
      const agg = new Map(dailyAggregates(u.id, from, today).map((d) => [d.day, d]));
      const calendar = [];
      let arrears = 0, missed = 0, streakMissed = 0;
      for (let i = 0; i < days; i++) {
        const day = addDays(from, i);
        const d = agg.get(day);
        const status = (!d || d.repaid === 0) && !due ? 'no_obligation' : !d || d.repaid === 0 ? 'missed' : d.repaidConfirmed >= d.repaid && d.repaid > 0 ? (due && d.repaid < 0.9 * due ? 'short_confirmed' : 'paid_confirmed') : (due && d.repaid < 0.9 * due ? 'short_unconfirmed' : 'paid_unconfirmed');
        if (day >= (u.onboarded_day ?? from)) {
          if (status === 'missed') { missed++; streakMissed++; } else streakMissed = 0;
          arrears += Math.max(0, due - (d?.repaid ?? 0));
        }
        calendar.push({ day, status, repaid: d?.repaid ?? 0, confirmed: d?.repaidConfirmed ?? 0 });
      }
      const sc = computeScore(u);
      out.push({ grant_id: g.id, rider: riderView(u), daily_due: due, calendar, missed_days: missed, current_missed_streak: streakMissed,
        estimated_arrears: arrears, alert: streakMissed >= 2 ? `${streakMissed} days without payment` : null,
        score: sc.score, band: sc.band, score_status: sc.status, last_active_day: u.last_active_day });
      logAccess(org.id, u.id, 'portfolio_view');
    }
    sendJson(s, 200, { days, from, to: today, riders: out });
  });

  // ---- Admin
  r.post('/api/admin/orgs', (q, s) => {
    requireAdmin(q);
    const kind = q.json?.kind;
    if (!['lessor', 'lender', 'agent'].includes(kind)) throw new HttpError(400, 'kind must be lessor | lender | agent');
    if (!q.json?.name) throw new HttpError(400, 'name required');
    const o = createOrg(String(q.json.name), kind);
    sendJson(s, 201, { ...o, note: 'Store this API key now; it is not shown again.' });
  });
  r.get('/api/admin/orgs', (q, s) => {
    requireAdmin(q);
    // Keys are stored hashed and can't be shown again; the prefix lets an admin match a key to its org.
    sendJson(s, 200, all(`SELECT o.id, o.name, o.kind, o.key_prefix, o.created_at,
      (SELECT COUNT(*) FROM grants g WHERE g.org_id = o.id AND g.status = 'granted') AS active_grants
      FROM orgs o ORDER BY o.created_at DESC`));
  });
  r.get('/api/admin/metrics', async (q, s) => {
    requireAdmin(q);
    sendJson(s, 200, { ...metrics(), active_users_30d: U.activeUserCount(), user_cap: config.userCap,
      cap_warning: U.activeUserCount() >= config.userCapWarn, queue: queueStats(), model_mode: config.modelMode });
  });
  r.get('/api/admin/model-health', async (q, s) => { requireAdmin(q); sendJson(s, 200, await modelHealth()); });
  r.post('/api/admin/reminders', (q, s) => { requireAdmin(q); sendJson(s, 200, sendReminders()); });
  r.get('/api/admin/interactions.csv', (q, s) => {
    requireAdmin(q);
    const rows = all(`SELECT i.created_at, i.channel, i.direction, i.kind, i.lang, i.model_path, i.asr_model, i.audio_seconds, i.asr_ms, i.llm_ms, i.intent, i.outcome,
                      i.transcript, i.extracted, substr(i.user_id, 1, 8) AS rider_ref FROM interactions i ORDER BY i.created_at`);
    const cols = ['created_at', 'rider_ref', 'channel', 'direction', 'kind', 'lang', 'model_path', 'asr_model', 'audio_seconds', 'asr_ms', 'llm_ms', 'intent', 'outcome', 'transcript', 'extracted'];
    const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    sendText(s, 200, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'), 'text/csv; charset=utf-8',
      { 'Content-Disposition': 'attachment; filename="ridepass-interactions.csv"' });
  });
}
