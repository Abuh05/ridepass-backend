// Landing page interactions. Plain JS, no dependencies; everything degrades to static content.
(() => {
  const $ = (id) => document.getElementById(id);
  const I = RP.icon, E = RP.esc, N = RP.naira;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 60) : ms));

  // ---------- mobile menu ----------
  const menu = $('mobileMenu'), mb = $('menuBtn');
  mb.onclick = () => { const open = menu.classList.toggle('open'); mb.setAttribute('aria-expanded', open); };
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) { menu.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); } });

  // ---------- phone demo: real rider-facing strings from the app (src/i18n.ts) ----------
  const DEMO = {
    en: { name: 'English', said: 'I made 14 thousand today, fuel 5,200, I paid owner 3,000.', fuel: 5200, processing: 'Got it 👍 checking your voice note…',
      confirm: 'I heard:\n{lines}\nDay: today\n\nIs this correct?', yes: 'Correct', no: 'Not correct', inc: 'Income', fu: 'Fuel', own: 'Owner payment',
      saved: 'Saved ✅ today: made {i}, spent {s}, net {n}.' },
    pcm: { name: 'Pidgin', said: 'I make 14 thousand today, fuel 5,200, I pay owner 3,000.', fuel: 5200, processing: 'I don hear 👍 make I check am…',
      confirm: 'Na wetin I hear be this:\n{lines}\nDay: today\n\nE correct?', yes: 'E correct', no: 'E no correct', inc: 'Money wey you make', fu: 'Fuel', own: 'Owner money',
      saved: 'I don save am ✅ today: you make {i}, you spend {s}, remain {n}.' },
    ha: { name: 'Hausa', said: 'Yau na samu dubu goma sha huɗu, mai dubu biyar, na biya mai keke dubu uku.', fuel: 5000, processing: 'Na karɓa 👍 ina dubawa…',
      confirm: 'Abin da na ji:\n{lines}\nRana: yau\n\nDaidai ne?', yes: 'Daidai ne', no: 'Ba daidai ba', inc: 'Kuɗin shiga', fu: 'Mai (fetur)', own: 'Biyan mai abin hawa',
      saved: 'An ajiye ✅ yau: ka samu {i}, ka kashe {s}, saura {n}.' },
    yo: { name: 'Yorùbá', said: 'Mo pa ẹgbẹ̀rún mẹ́rìnlá lónìí, epo ẹgbẹ̀rún márùn-ún, mo san ẹgbẹ̀rún mẹ́ta fún olówó ọkọ̀.', fuel: 5000, processing: 'Mo ti gbà á 👍 mò ń yẹ̀ ẹ́ wò…',
      confirm: 'Ohun tí mo gbọ́:\n{lines}\nỌjọ́: òní\n\nṢé ó tọ̀nà?', yes: 'Ó tọ̀nà', no: 'Kò tọ̀nà', inc: 'Owó tí o pa', fu: 'Epo', own: 'Owó olówó ọkọ̀',
      saved: 'A ti fi pamọ́ ✅ òní: o pa {i}, o ná {s}, ó ku {n}.' },
    ig: { name: 'Igbo', said: 'Enwetara m puku iri na anọ taa, mmanụ puku ise, akwụrụ m onye nwe ụgbọ puku atọ.', fuel: 5000, processing: 'Anatala m ya 👍 ana m enyocha ya…',
      confirm: 'Ihe m nụrụ:\n{lines}\nỤbọchị: taa\n\nỌ ziri ezi?', yes: 'Ọ ziri ezi', no: 'Ọ ziighi ezi', inc: 'Ego i nwetara', fu: 'Mmanụ ụgbọ', own: 'Ego onye nwe ụgbọ',
      saved: 'Echekwara ya ✅ taa: i nwetara {i}, i mefuru {s}, fọdụrụ {n}.' },
  };
  const order = Object.keys(DEMO);
  const thread = $('thread'), status = $('demoStatus'), tabs = $('langTabs');
  let run = 0, current = 0, userPicked = false;
  tabs.innerHTML = order.map((k, i) => `<button role="tab" data-i="${i}">${E(DEMO[k].name)}</button>`).join('');
  tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) { userPicked = true; play(+b.dataset.i); } };

  function add(html, dir) {
    const d = document.createElement('div'); d.className = 'b ' + dir; d.innerHTML = html; thread.appendChild(d);
    while (thread.children.length > 6) thread.firstElementChild.remove();
    return d;
  }
  const wave = () => '<span class="wave">' + Array.from({ length: 22 }, (_, i) => `<i style="height:${6 + Math.round(Math.abs(Math.sin(i * 1.7)) * 14)}px;animation-delay:${(i % 6) * 0.09}s"></i>`).join('') + '</span>';

  async function play(i) {
    const id = ++run; current = i;
    tabs.querySelectorAll('button').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i); });
    const L = DEMO[order[i]], alive = () => id === run;
    thread.innerHTML = ''; status.textContent = 'online';
    await sleep(500); if (!alive()) return;
    add(`<div class="vn"><span class="play"></span>${wave()}<small>0:06</small></div><div class="said">“${E(L.said)}”</div>`, 'out');
    await sleep(1300); if (!alive()) return;
    add(E(L.processing), 'in'); status.textContent = 'typing…';
    const t = add('<span class="dots"><i></i><i></i><i></i></span>', 'in');
    await sleep(1600); if (!alive()) return;
    t.remove(); status.textContent = 'online';
    const lines = `• ${L.inc}: ${N(14000)}\n• ${L.fu}: ${N(L.fuel)}\n• ${L.own}: ${N(3000)}`;
    const c = add(E(L.confirm.replace('{lines}', lines)) + `<div class="chips"><span>${E(L.yes)}</span><span>${E(L.no)}</span></div>`, 'in');
    await sleep(1900); if (!alive()) return;
    c.querySelector('.chips span').classList.add('picked');
    await sleep(500); if (!alive()) return;
    add(E(L.yes), 'out');
    await sleep(900); if (!alive()) return;
    const spent = L.fuel + 3000;
    add(E(L.saved.replace('{i}', N(14000)).replace('{s}', N(spent)).replace('{n}', N(14000 - spent))), 'in');
    await sleep(3600); if (!alive()) return;
    if (!userPicked) play((current + 1) % order.length); // auto-tour the languages until someone picks one
  }

  // ---------- trust strip ----------
  $('strip').innerHTML = [['mic', 'N-ATLAS speech in 4 languages + Pidgin'], ['shield', 'Ed25519-signed passports'], ['hash', 'Hash-chained ledger'], ['users', 'Owner-confirmed payments'], ['key', 'Consent-first (NDPA 2023)']]
    .map(([ic, t]) => `<span>${I(ic)}${E(t)}</span>`).join('');

  // ---------- how-it-works stepper ----------
  const STEPS = [
    { t: 'Speak', d: 'One voice note in the evening, in English, Pidgin, Hausa, Yorùbá or Igbo. No typing needed.',
      v: () => `<div class="mini" style="text-align:center"><div class="mic-big">${I('mic')}</div><b>“I made 14 thousand, fuel 5,200, I paid owner 3,000”</b><p class="muted" style="margin:8px 0 0">WhatsApp, the web app, or a field agent’s phone</p></div>` },
    { t: 'Confirm', d: 'RidePass reads it back in the rider’s language. Nothing is saved until they tap “Correct”.',
      v: () => `<div class="mini"><h4>I heard:</h4><div class="row2"><span>Income</span><b>₦14,000</b></div><div class="row2"><span>Fuel</span><b>₦5,200</b></div><div class="row2"><span>Owner payment</span><b>₦3,000</b></div>
        <div class="actions" style="margin-top:12px"><span class="pill ok" style="padding:7px 14px">✓ Correct</span><span class="pill" style="padding:7px 14px">Not correct</span></div></div>` },
    { t: 'Owner confirms', d: 'The vehicle owner taps Yes or No on WhatsApp or a link. Confirmed payments carry more weight.',
      v: () => `<div class="mini"><h4>Payment confirmation</h4><p style="margin:0 0 12px">Musa says they paid you <b>₦3,000</b> today. Is this correct?</p><div class="big-actions"><button class="lg" tabindex="-1">${I('check')}Yes, correct</button><button class="lg danger" tabindex="-1">${I('x')}Not correct</button></div></div>` },
    { t: 'Share the passport', d: 'After 14 active days the rider gets a signed passport and shares it by code. Every view is logged.',
      v: () => `<div class="mini" style="text-align:center"><h4>Share code for a lender</h4><div class="code-chip">8QZU&nbsp;Y22E</div><p class="muted" style="margin:10px 0 0">Valid 7 days · revoke anytime with STOP SHARING</p></div>
        <div class="mini" style="display:flex;align-items:center;gap:10px"><span class="pill ok"><span class="dot"></span>Signature &amp; ledger verified</span><span class="muted small">Score 87 · Band A</span></div>` },
  ];
  const stepsEl = $('steps'), stage = $('stage'), DUR = 5200;
  let stepIdx = 0, stepTimer;
  stepsEl.innerHTML = STEPS.map((s, i) => `<button class="step2" data-i="${i}" style="--dur:${DUR}ms"><span class="n">${i + 1}</span><span><h3>${E(s.t)}</h3><p>${E(s.d)}</p></span><span class="prog"></span></button>`).join('');
  function showStep(i, auto) {
    stepIdx = i;
    stepsEl.querySelectorAll('.step2').forEach((b, j) => { b.classList.remove('on'); void b.offsetWidth; b.classList.toggle('on', j === i); b.setAttribute('aria-current', j === i ? 'step' : 'false'); });
    stage.innerHTML = `<div>${STEPS[i].v()}</div>`;
    clearTimeout(stepTimer);
    if (auto && !reduce) stepTimer = setTimeout(() => showStep((i + 1) % STEPS.length, true), DUR);
  }
  stepsEl.onclick = (e) => { const b = e.target.closest('.step2'); if (b) showStep(+b.dataset.i, false); };

  // ---------- sample passport ----------
  const COMP = [['Consistency', 22.8, 25], ['Repayment', 24.4, 25], ['Stability', 17.2, 20], ['Verification', 9.7, 15], ['Affordability', 10, 10], ['Tenure', 2.5, 5]];
  $('ppBars').innerHTML = '<div class="bars">' + COMP.map(([k, p, m]) => `<div class="bar-row"><span class="name">${k}</span><div class="bar"><i data-w="${(p / m) * 100}"></i></div><span class="pts"><b>${p}</b> / ${m}</span></div>`).join('') + '</div>';
  $('ppChecks').innerHTML = [
    ['chart', 'Behaviour-only score', 'Logging regularity, repayment, income stability, owner verification, affordability, tenure. Never language, gender, ethnicity, religion or location.'],
    ['shield', 'Verifiable by anyone', 'Ed25519 signature plus a hash-chained ledger: any edit after issue is detected on the public verifier.'],
    ['wallet', 'Affordability check', 'Lenders enter a proposed daily repayment and see whether it is affordable, a stretch, or too high.'],
    ['key', 'The rider stays in control', 'Shared only by code or approved request. STOP SHARING revokes access instantly.'],
  ].map(([ic, b, s]) => `<li><span class="ck">${I(ic)}</span><span><b>${E(b)}</b><span>${E(s)}</span></span></li>`).join('');
  function animatePassport() {
    const arc = $('ppCard').querySelector('.arc'), C = 2 * Math.PI * 52, target = 87;
    arc.setAttribute('stroke-dasharray', `${(C * target / 100).toFixed(1)} ${C.toFixed(1)}`);
    countUp($('ppScore'), target, 1500);
    $('ppCard').querySelectorAll('.bar i').forEach((b) => (b.style.width = b.dataset.w + '%'));
  }

  // ---------- EV calculator (same formula as src/ev.ts, default constants from src/config.ts) ----------
  const EV = { petrol: 1000, elec: 209, days: 26, kmPerL: { keke: 25, okada: 40, bus: 9 }, kwhPerKm: { keke: 0.07, okada: 0.035, bus: 0.25 }, conv: { keke: 2500000, okada: 1200000, bus: 9000000 } };
  let veh = 'keke';
  function calcEV() {
    const fuel = +$('evFuel').value;
    const km = (fuel / EV.petrol) * EV.kmPerL[veh];
    const elec = km * EV.kwhPerKm[veh] * EV.elec;
    const save = (fuel - elec) * EV.days;
    const pay = save > 0 ? Math.ceil(EV.conv[veh] / save) : null;
    $('evFuelVal').textContent = N(fuel);
    $('evSave').textContent = N(save);
    $('evKm').textContent = Math.round(km) + ' km';
    $('evElec').textContent = N(elec);
    $('evConv').textContent = N(EV.conv[veh]);
    $('evPay').textContent = pay ? pay + (pay === 1 ? ' month' : ' months') : '—';
    const pct = ((fuel - 1000) / 24000) * 100;
    $('evFuel').style.background = `linear-gradient(90deg, var(--brand) ${pct}%, var(--bg-soft) ${pct}%)`;
  }
  $('evFuel').oninput = calcEV;
  $('evVeh').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    veh = b.dataset.v; $('evVeh').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); calcEV();
  };
  calcEV();

  // ---------- roles ----------
  $('roleCards').innerHTML = [
    ['/rider', 'mic', '', 'Riders', ['Log money by voice every evening', 'Get a credit passport after 14 days', 'Share it, or stop sharing, any time']],
    ['/agent', 'users', 'amber', 'Field agents', ['Onboard riders at the park', 'Record for riders without WhatsApp', 'Verify vehicle owners in person']],
    ['/guide#owner', 'phone', 'blue', 'Vehicle owners', ['Confirm each payment with one tap', 'No app or account needed', 'Dispute anything that’s wrong']],
    ['/dashboard', 'chart', '', 'Lessors', ['Daily repayment calendar per rider', 'Arrears estimate and missed-day alerts', 'Register your collection phone']],
    ['/dashboard', 'wallet', 'amber', 'Lenders', ['Redeem a rider’s share code', 'Explainable score and affordability check', 'Verify signatures independently']],
    ['/admin', 'key', 'blue', 'Programme admin', ['Create lessor, lender and agent keys', 'Monitor models and pilot metrics', 'Export validation evidence']],
  ].map(([href, ic, tone, t, items]) => `<a class="role reveal" href="${href}"><span class="icon-chip ${tone}">${I(ic)}</span><h3>${E(t)}</h3><ul>${items.map((x) => `<li>${E(x)}</li>`).join('')}</ul><span class="go">Open ${I('arrow')}</span></a>`).join('');

  $('trust').innerHTML = [
    ['key', 'Consent first', 'Nothing is stored until the rider agrees. MY DATA downloads everything; DELETE MY DATA erases it.'],
    ['shield', 'Encrypted at rest', 'Names and phone numbers are encrypted; phone lookups use keyed hashes.'],
    ['hash', 'Tamper-evident', 'Every entry is hash-chained. A signed passport fails verification if history changes.'],
    ['users', 'Every view logged', 'Riders can see which organisation viewed their records and when.'],
  ].map(([ic, t, d]) => `<div><span class="icon-chip">${I(ic)}</span><h3>${E(t)}</h3><p>${E(d)}</p></div>`).join('');

  // ---------- count-up + scroll reveal ----------
  function countUp(el, to, ms = 1100) {
    if (reduce) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const once = new WeakSet();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting || once.has(en.target)) continue;
      once.add(en.target); en.target.classList.add('in');
      if (en.target.id === 'ppCard') animatePassport();
      if (en.target.id === 'steps') showStep(0, true);
    }
  }, { threshold: 0.18 }) : null;
  document.querySelectorAll('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
  if (!io) { animatePassport(); showStep(0, false); }
  document.querySelectorAll('[data-count]').forEach((el) => countUp(el, +el.dataset.count));
  play(0);
})();
