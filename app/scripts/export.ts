// Writes the validation evidence pack for the NAIC submission into ./evidence/
import { mkdirSync, writeFileSync } from 'node:fs';
const { all } = await import('../src/db.ts');
const { metrics } = await import('../src/interactions.ts');
mkdirSync('./evidence', { recursive: true });
const rows = all(`SELECT created_at, substr(user_id,1,8) rider_ref, channel, direction, kind, lang, model_path, asr_model, audio_seconds, asr_ms, llm_ms, intent, outcome, transcript, extracted
                  FROM interactions WHERE model_path IS NULL OR model_path != 'mock' ORDER BY created_at`);
const cols = Object.keys(rows[0] ?? { created_at: 1 });
const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync('./evidence/interactions.csv', [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
writeFileSync('./evidence/metrics.json', JSON.stringify(metrics(), null, 2));
console.log(`evidence/interactions.csv (${rows.length} rows) and evidence/metrics.json written`);
console.log(metrics());
