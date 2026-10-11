// Rule-based extractor. Used when N-ATLAS is unreachable, and as an independent guard.
import { extractAmounts, tokenize } from './numbers.ts';
import { keywordHits, mentionsYesterday, type EntryType } from './keywords.ts';

export type Draft = { type: EntryType; amount: number };
export type Extraction = { intent: 'log' | 'question' | 'other'; day: 'today' | 'yesterday'; entries: Draft[]; unassigned: number[] };

export function ruleExtract(text: string): Extraction {
  const amounts = extractAmounts(text);
  const hits = keywordHits(text);
  const toks = tokenize(text);
  const boundaries = toks.map((t, i) => (t.norm === '|' ? i : -1)).filter((i) => i >= 0);
  const clauseOf = (pos: number) => boundaries.filter((b) => b < pos).length;

  const entries: Draft[] = [];
  const unassigned: number[] = [];
  let prevEnd = 0;
  amounts.forEach((a, idx) => {
    const nextStart = amounts[idx + 1]?.start ?? toks.length;
    // 1) nearest keyword before the amount, after the previous amount, same clause
    const span = [...hits].reverse().filter((h) => h.pos < a.start && h.pos >= prevEnd && clauseOf(h.pos) === clauseOf(a.start));
    let hit: (typeof hits)[number] | undefined = span.find((h) => !h.weak) ?? span[0];
    // 2) keyword right after the amount ("5000 for fuel")
    if (!hit) hit = hits.find((h) => h.pos >= a.end && h.pos < Math.min(nextStart, a.end + 4) && clauseOf(h.pos) === clauseOf(a.start));
    // 3) keyword before the amount in the previous span, any clause
    if (!hit) hit = [...hits].reverse().find((h) => h.pos < a.start && h.pos >= prevEnd);
    if (hit) entries.push({ type: hit.type, amount: a.value });
    else unassigned.push(a.value);
    prevEnd = a.end;
  });
  // A lone unlabelled amount at the start is almost always the day's income.
  if (entries.length === 0 && unassigned.length === 1) { entries.push({ type: 'income', amount: unassigned[0] }); unassigned.length = 0; }
  const isQuestion = /\?|^(how|what|why|should|can|shey|abeg|ya|yaya|me|kedu|gini|bawo|se)\b/i.test(text.trim());
  return {
    intent: entries.length ? 'log' : isQuestion ? 'question' : 'other',
    day: mentionsYesterday(text) ? 'yesterday' : 'today',
    entries,
    unassigned,
  };
}
