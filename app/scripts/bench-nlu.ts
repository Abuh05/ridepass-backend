// Extraction benchmark: N-ATLaS (with guard-rails) vs the rule-based baseline on labelled rider messages.
// Add real pilot transcripts to bench/nlu_cases.jsonl as they are labelled.
// Usage: npm run bench:nlu   (needs LLM_BASE_URL + MODEL_SERVICE_TOKEN for the N-ATLaS column)
import { readFileSync, writeFileSync } from 'node:fs';
const { extract } = await import('../src/nlu/extract.ts');
const { ruleExtract } = await import('../src/nlu/fallback.ts');

type Case = { lang: string; text: string; day: string; entries: [string, number][] };
const cases: Case[] = readFileSync('bench/nlu_cases.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const key = (es: { type: string; amount: number }[]) => es.map((e) => `${e.type}:${e.amount}`).sort().join('|');
const gold = (c: Case) => c.entries.map(([t, a]) => `${t}:${a}`).sort().join('|');

const stats: Record<string, { n: number; rules: number; natlas: number; natlasRan: number; paths: Record<string, number> }> = {};
const rows: string[] = ['lang,text,gold,rules,natlas,path'];
for (const c of cases) {
  const s = (stats[c.lang] ??= { n: 0, rules: 0, natlas: 0, natlasRan: 0, paths: {} });
  s.n++;
  const r = ruleExtract(c.text);
  const rOk = key(r.entries) === gold(c) && r.day === c.day;
  if (rOk) s.rules++;
  const x = await extract(c.text);
  s.paths[x.path] = (s.paths[x.path] ?? 0) + 1;
  const xOk = key(x.entries) === gold(c) && x.day === c.day;
  if (x.path.startsWith('natlas')) { s.natlasRan++; if (xOk) s.natlas++; }
  rows.push([c.lang, JSON.stringify(c.text), gold(c), key(r.entries), key(x.entries), x.path].join(','));
}
writeFileSync('bench/results.csv', rows.join('\n'));
console.log('lang   cases  rules-exact  natlas-exact  paths');
for (const [lang, s] of Object.entries(stats)) {
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) + '%' : 'n/a');
  console.log(`${lang.padEnd(6)} ${String(s.n).padStart(5)}  ${pct(s.rules, s.n).padStart(11)}  ${pct(s.natlas, s.natlasRan).padStart(12)}  ${JSON.stringify(s.paths)}`);
}
console.log('Exact match = every type, amount and day correct. Details: bench/results.csv');
