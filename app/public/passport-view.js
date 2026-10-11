// Renders a signed passport payload (used by share.html, verify.html and dashboard.html).
window.renderPassport = function (el, payload, verification, affordability) {
  const p = payload, s = p.score, st = p.stats, N = RP.naira, E = RP.esc, I = RP.icon;
  const tone = { A: 'ok', B: 'ok', C: 'warn', D: 'bad', E: 'bad' }[s.band] || '';
  const toneColor = { ok: 'var(--ok)', warn: 'var(--accent)', bad: 'var(--bad)' }[tone] || 'var(--brand)';
  const label = (k) => E(String(k).replace(/_/g, ' '));

  const scored = s.status === 'scored';
  const C = 2 * Math.PI * 52, frac = scored ? Math.max(0, Math.min(1, s.value / 100)) : Math.min(1, st.active_days / 14);
  const gauge = `<div class="gauge" role="img" aria-label="${scored ? `Score ${s.value} of 100, band ${E(s.band)}` : `Building history: ${st.active_days} days logged`}">
    <svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52" fill="none" stroke-width="10"/>
      <circle cx="60" cy="60" r="52" fill="none" stroke="${scored ? toneColor : 'var(--muted)'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}"/></svg>
    <div class="center">${scored ? `<div class="val">${s.value}</div><div class="lbl">BAND ${E(s.band)}</div>` : `<div class="val" style="font-size:26px">${st.active_days}/14</div><div class="lbl">DAYS LOGGED</div>`}</div></div>`;

  const v = !verification ? '' : verification.valid
    ? `<div class="verify-banner ok">${I('shield')} Signature &amp; ledger verified</div>`
    : `<div class="verify-banner bad">${I('alert')} Verification failed
        <span class="checks">${Object.entries(verification.checks || {}).map(([k, ok]) => `<span>${ok ? '✓' : '✗'} ${label(k)}</span>`).join('')}</span></div>`;

  const aff = affordability ? (() => {
    const t = affordability.verdict === 'affordable' ? 'ok' : affordability.verdict === 'stretch' ? 'warn' : 'bad';
    return `<div class="afford"><b>Affordability</b><span class="pill ${t}"><span class="dot"></span>${E(affordability.verdict)}</span>
      <span class="muted">Max recommended <b style="color:var(--ink)">${N(affordability.max_recommended_daily)}</b> / day</span></div>`;
  })() : '';

  const stats = [
    [`${st.active_days}/${st.window_days}`, 'days logged'],
    [N(st.avg_daily_income), 'avg daily income'],
    [N(st.avg_daily_expenses), 'avg daily costs'],
    [N(st.avg_daily_repayment), 'avg daily repayment'],
    [`${st.verified_repayment_pct}%`, 'repayments confirmed by owner' + (st.owner_verified ? ' (verified owner)' : '')],
    [st.income_stability, 'income stability (0–1)'],
    [st.disputed_payments, 'disputed payments'],
    [st.flagged_entries, 'flagged days'],
  ];

  const bars = scored ? Object.entries(s.components).map(([k, c]) => {
    const neg = c.points < 0, pct = neg ? Math.min(100, Math.abs(c.points) * 10) : c.max ? Math.max(0, Math.min(100, (c.points / c.max) * 100)) : 0;
    return `<div class="bar-row"><span class="name">${label(k)}</span><div class="bar${neg ? ' neg' : ''}"><i style="width:${pct.toFixed(0)}%"></i></div>
      <span class="pts"><b>${c.points}</b>${c.max ? ' / ' + c.max : ''}</span></div>`;
  }).join('') : '';

  el.innerHTML = `<div class="passport">
  <div class="card">
    <div class="pp-hero">
      <div>
        <div class="eyebrow">RidePass credit passport · <span class="mono">${E(p.id.slice(0, 8))}</span></div>
        <h2>${E(p.rider.first_name)}</h2>
        <div class="pp-meta">
          ${p.rider.vehicle ? `<span class="pill brand">${E(p.rider.vehicle)}</span>` : ''}
          ${p.rider.ownership ? `<span class="pill">${label(p.rider.ownership)}</span>` : ''}
          ${scored ? `<span class="pill ${tone}"><span class="dot"></span>Band ${E(s.band)}</span>` : '<span class="pill warn"><span class="dot"></span>Building history</span>'}
        </div>
        <div class="muted" style="margin-top:12px">Member since ${E(p.rider.member_since)} · Issued ${E(p.issued_at.slice(0, 10))} · Valid to ${E(p.expires_at)}</div>
      </div>
      ${gauge}
    </div>
    ${v}${aff}
  </div>
  <div class="card">
    <div class="card-head"><div class="icon-chip">${I('chart')}</div><div><h2>Last ${st.window_days} days</h2><p class="muted">Self-reported by voice, cross-checked and owner-confirmed where possible.</p></div></div>
    <div class="grid">${stats.map(([b, t]) => `<div class="stat"><b>${E(b)}</b><span>${E(t)}</span></div>`).join('')}</div>
  </div>
  ${scored ? `<div class="card">
    <div class="card-head"><div class="icon-chip amber">${I('wallet')}</div><div><h2>Why this score</h2><p class="muted">Behaviour-only. Language, gender, ethnicity, religion and location are never used.</p></div></div>
    <div class="reasons">
      ${(s.reasons.positive || []).map((r) => `<div class="reason pos"><span class="ic">✓</span><span>${E(r)}</span></div>`).join('')}
      ${(s.reasons.negative || []).map((r) => `<div class="reason neg"><span class="ic">!</span><span>${E(r)}</span></div>`).join('')}
    </div>
    <div class="bars">${bars}</div>
  </div>` : ''}
  <div class="card">
    <div class="ledger-foot">
      <span>${I('hash')} ${p.ledger.entries} hash-chained entries · head <code>${E(p.ledger.head.slice(0, 16))}…</code></span>
      <span>${I('mic')} ${E(p.model.asr)}</span>
      <span>${I('cpu')} ${E(p.model.llm)}</span>
    </div>
  </div>
</div>`;
};
