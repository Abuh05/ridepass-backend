// DEMO DATA ONLY — builds data/demo.db with realistic riders so you can show the dashboard in the video
// before the pilot has 14+ days of history. It refuses to touch any other database, and demo data
// must never be reported as pilot validation.
process.env.DB_PATH = './data/demo.db';
process.env.MODEL_MODE = 'mock';
const { rmSync } = await import('node:fs');
for (const f of ['./data/demo.db', './data/demo.db-wal', './data/demo.db-shm']) rmSync(f, { force: true });

const { run } = await import('../src/db.ts');
const U = await import('../src/users.ts');
const { appendEntries } = await import('../src/ledger.ts');
const { createOrg } = await import('../src/auth.ts');
const { requestGrant, decideGrant, newShareCode, recordConsent } = await import('../src/grants.ts');
const { addDays, lagosDay, uid, nowIso } = await import('../src/util.ts');
const { hashSecret } = await import('../src/crypto.ts');
const { linkOwner } = await import('../src/attest.ts');

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const lessor = createOrg('Demo Keke Leasing Ltd', 'lessor');
const lender = createOrg('Demo Microfinance Bank', 'lender');
const agent = createOrg('Phoenix Field Agents', 'agent');
const ownerPhone = '2348120000001';
const owner = U.createUser(ownerPhone, { role: 'owner' });
U.update(owner.id, { verified_owner: 1 });

const riders = [
  { name: 'Musa Ibrahim', lang: 'ha', vehicle: 'keke', own: 'hire_purchase', remit: 3000, base: 14000, reliability: 0.95, days: 45 },
  { name: 'Chinedu Okafor', lang: 'ig', vehicle: 'keke', own: 'hire_purchase', remit: 3000, base: 13000, reliability: 0.85, days: 40 },
  { name: 'Tunde Adebayo', lang: 'yo', vehicle: 'okada', own: 'daily_rent', remit: 2000, base: 9000, reliability: 0.7, days: 35 },
  { name: 'Blessing Eze', lang: 'pcm', vehicle: 'keke', own: 'hire_purchase', remit: 3500, base: 15500, reliability: 0.92, days: 30 },
  { name: 'Aliyu Sani', lang: 'ha', vehicle: 'okada', own: 'own', remit: 0, base: 8500, reliability: 1, days: 25 },
  { name: 'Emeka Nwosu', lang: 'en', vehicle: 'bus', own: 'hire_purchase', remit: 8000, base: 32000, reliability: 0.55, days: 30 },
  { name: 'Yusuf Bello', lang: 'ha', vehicle: 'keke', own: 'hire_purchase', remit: 3000, base: 12000, reliability: 0.9, days: 10 },
];
const out: string[] = [];
riders.forEach((r, idx) => {
  const phone = `23480300000${10 + idx}`;
  const u = U.createUser(phone, { channel: 'whatsapp', lang: r.lang });
  U.setName(u.id, r.name);
  U.update(u.id, { vehicle: r.vehicle, ownership: r.own, daily_remit: r.remit || null, consent_version: 'demo', consent_at: nowIso(), onboarded_day: addDays(lagosDay(), -(r.days - 1)), pin_hash: hashSecret('1234') });
  U.setState(u.id, 'active');
  recordConsent(u.id, 'data_processing', true, { demo: true });
  if (r.own !== 'own') linkOwner(U.getUser(u.id)!, ownerPhone);
  for (let d = r.days - 1; d >= 0; d--) {
    if (rnd() > 0.9) continue; // rest days
    const day = addDays(lagosDay(), -d);
    const income = Math.round((r.base * (0.8 + rnd() * 0.4)) / 100) * 100;
    const items: any[] = [
      { type: 'income', amount: income, day, source: 'voice' },
      { type: 'fuel', amount: Math.round((income * (0.28 + rnd() * 0.06)) / 100) * 100, day, source: 'voice' },
    ];
    if (rnd() < 0.15) items.push({ type: 'levy', amount: 500, day, source: 'voice' });
    if (rnd() < 0.06) items.push({ type: 'repair', amount: 2000 + Math.round(rnd() * 6) * 500, day, source: 'voice' });
    if (r.own === 'own' && rnd() < 0.6) items.push({ type: 'savings', amount: 1000, day, source: 'voice' });
    const pays = r.own !== 'own' && rnd() < r.reliability;
    if (pays) items.push({ type: r.own === 'hire_purchase' ? 'loan_repayment' : 'owner_payment', amount: r.remit, day, source: 'voice' });
    const saved = appendEntries(u.id, items);
    if (pays) {
      const status = rnd() < 0.85 ? 'confirmed' : rnd() < 0.5 ? 'pending' : 'disputed';
      run('INSERT INTO attestations (id, entry_id, rider_id, owner_id, token_hash, status, via, created_at, responded_at) VALUES (?,?,?,?,?,?,?,?,?)',
        uid(), saved.at(-1)!.id, u.id, owner.id, uid(), status, 'whatsapp', nowIso(), nowIso());
    }
  }
  if (idx < 5 && r.own !== 'own') { const g = requestGrant(lessor.id, u.id, 'portfolio', r.remit || undefined); decideGrant(g, true); }
  if (idx === 0 || idx === 3) { const g = requestGrant(lender.id, u.id, 'passport'); decideGrant(g, true); }
  out.push(`${r.name.padEnd(16)} ${r.lang.padEnd(4)} ${r.vehicle.padEnd(6)} phone 0${phone.slice(3)}  PIN 1234  share code ${newShareCode(u.id)}`);
});

console.log(`Demo database written to data/demo.db

Start it:   DB_PATH=./data/demo.db MODEL_MODE=mock npm start
Dashboard:  http://localhost:8080/dashboard
  Lessor key: ${lessor.apiKey}
  Lender key: ${lender.apiKey}
  Agent key:  ${agent.apiKey}

Riders:
${out.join('\n')}

⚠️  Demo data is synthetic. Never include it in NAIC validation evidence.`);
