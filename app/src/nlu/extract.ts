// N-ATLAS extraction with guard-rails:
//  1. N-ATLaS turns the transcript into structured entries (constrained JSON).
//  2. Output is validated; every amount must be supported by the multilingual number parser.
//  3. If N-ATLaS fails or invents amounts, the rule-based extractor is used and the path is logged.
import { chat, ModelError } from '../models.ts';
import { amountSupported } from './numbers.ts';
import { ruleExtract, type Draft, type Extraction } from './fallback.ts';
import { ENTRY_TYPES, type EntryType } from './keywords.ts';

export type ModelPath = 'natlas' | 'natlas_guarded' | 'fallback' | 'keyword' | 'mock' | 'none';
export type ExtractResult = Extraction & { path: ModelPath; llmMs: number; lowConfidence: boolean; raw?: string };

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['log', 'question', 'other'] },
    day: { type: 'string', enum: ['today', 'yesterday'] },
    entries: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object',
        properties: { type: { type: 'string', enum: [...ENTRY_TYPES] }, amount: { type: 'integer', minimum: 1, maximum: 10000000 } },
        required: ['type', 'amount'],
      },
    },
  },
  required: ['intent', 'day', 'entries'],
};

const SYSTEM = `You are RidePass, a bookkeeping assistant for Nigerian keke, okada and bus riders.
Riders speak English, Nigerian Pidgin, Hausa, Yoruba or Igbo, often mixed. Read the rider's message and extract money records.
Entry types:
- income: money earned from passengers/trips today
- fuel: petrol/fuel/gas bought ("mai" in Hausa, "epo" in Yoruba, "mmanụ" in Igbo)
- charging: electricity or battery swap for an electric vehicle
- owner_payment: daily remittance paid to the vehicle owner ("mai keke", "olówó ọkọ̀", "onye nwe ụgbọ", "oga")
- loan_repayment: hire-purchase, lease or loan instalment
- repair: mechanic, spare parts, tyres, servicing
- levy: union dues, park ticket, agbero, task force, tax
- savings: money put in ajo/esusu/adashe/isusu or savings
- other_expense: any other spending
Rules:
- Amounts are whole Naira. "k" = thousand. Hausa "dubu", Igbo "puku", Yoruba "ẹgbẹ̀rún" = thousand; Hausa "dari", Igbo "nari", Yoruba "ọgọ́rùn-ún" = hundred.
- ONLY include amounts the rider actually said. Never guess or add amounts.
- day = "yesterday" only if the rider says yesterday (jiya / àná / ụnyahụ); otherwise "today".
- intent = "log" when there are money records, "question" when the rider asks something, else "other".
Reply with JSON only.`;

const FEWSHOT: [string, string][] = [
  ['I make 14 thousand today, fuel 5,200, I pay owner 3k', '{"intent":"log","day":"today","entries":[{"type":"income","amount":14000},{"type":"fuel","amount":5200},{"type":"owner_payment","amount":3000}]}'],
  ['Jiya na samu dubu goma sha biyu, mai dubu hudu, haraji dari biyar', '{"intent":"log","day":"yesterday","entries":[{"type":"income","amount":12000},{"type":"fuel","amount":4000},{"type":"levy","amount":500}]}'],
  ['Mo pa ẹgbẹ̀rún mẹ́wàá lónìí, mo ra epo ẹgbẹ̀rún mẹ́ta, mo san ẹgbẹ̀rún méjì fún olówó ọkọ̀', '{"intent":"log","day":"today","entries":[{"type":"income","amount":10000},{"type":"fuel","amount":3000},{"type":"owner_payment","amount":2000}]}'],
  ['Enwetara m puku iri na ise taa, mmanụ puku anọ, mmezi puku abụọ', '{"intent":"log","day":"today","entries":[{"type":"income","amount":15000},{"type":"fuel","amount":4000},{"type":"repair","amount":2000}]}'],
  ['Abeg how I fit take save money every week?', '{"intent":"question","day":"today","entries":[]}'],
];

export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

export function validateExtraction(v: unknown): Extraction | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const intent = o.intent === 'log' || o.intent === 'question' ? o.intent : 'other';
  const day = o.day === 'yesterday' ? 'yesterday' : 'today';
  if (!Array.isArray(o.entries)) return null;
  const entries: Draft[] = [];
  for (const e of o.entries as Record<string, unknown>[]) {
    const type = e?.type as EntryType;
    const amount = Math.round(Number(e?.amount));
    if (!ENTRY_TYPES.includes(type) || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return null;
    entries.push({ type, amount });
  }
  return { intent: entries.length ? 'log' : intent, day, entries, unassigned: [] };
}

export async function extract(transcript: string, opts: { mock?: boolean } = {}): Promise<ExtractResult> {
  const rules = ruleExtract(transcript);
  if (opts.mock) return { ...rules, path: 'mock', llmMs: 0, lowConfidence: rules.unassigned.length > 0 };

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    ...FEWSHOT.flatMap(([u, a]) => [{ role: 'user' as const, content: u }, { role: 'assistant' as const, content: a }]),
    { role: 'user' as const, content: transcript },
  ];
  try {
    const { text, ms } = await chat(messages, { schema: EXTRACT_SCHEMA, maxTokens: 400 });
    const parsed = validateExtraction(parseJsonLoose(text));
    if (!parsed) return { ...rules, path: 'fallback', llmMs: ms, lowConfidence: true, raw: text };
    const unsupported = parsed.entries.filter((e) => !amountSupported(e.amount, transcript));
    if (unsupported.length === 0) {
      return { ...parsed, path: 'natlas', llmMs: ms, lowConfidence: rules.unassigned.length > 0, raw: text };
    }
    // N-ATLaS produced an amount that isn't in the transcript. Prefer the rule parse when it is complete.
    if (rules.entries.length && rules.unassigned.length === 0) {
      return { ...rules, path: 'natlas_guarded', llmMs: ms, lowConfidence: true, raw: text };
    }
    return { ...parsed, path: 'natlas_guarded', llmMs: ms, lowConfidence: true, raw: text };
  } catch (e) {
    if (!(e instanceof ModelError)) throw e;
    return { ...rules, path: 'fallback', llmMs: 0, lowConfidence: true };
  }
}
