// Multilingual money-amount parser: English, Nigerian Pidgin, Hausa, Igbo, Yorùbá.
// Used (1) to cross-check every amount N-ATLAS extracts against what was actually said, and
// (2) by the rule-based fallback extractor when the LLM is unavailable.
//
// English puts the scale AFTER the number ("fourteen thousand"); Hausa, Igbo and Yorùbá put it
// BEFORE ("dubu goma sha huɗu", "puku iri na anọ", "ẹgbẹ̀rún mẹ́rìnlá" = 14,000).

export type Token = { raw: string; norm: string; i: number };

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ɗ]/g, 'd').replace(/[ƙ]/g, 'k').replace(/[ɓ]/g, 'b').replace(/[ƴ]/g, 'y')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')          // strip tone marks / dots (ọ→o, ṣ→s, ẹ→e)
    .replace(/(\d)[,](?=\d{3}\b)/g, '$1')                       // 14,000 -> 14000
    .replace(/(^|[\s(])(?:₦|ngn|n)\s?(?=\d)/g, '$1')            // ₦14000 / N14000 -> 14000
    .replace(/(\w)['’-](\w)/g, '$1$2')                           // marun-un -> marunun, arba'in -> arbain
    .replace(/[,;:!?]/g, ' | ')                                  // clause boundaries stop number parsing
    .replace(/[^\w.|\s]/g, ' ')
    .replace(/\.(?!\d)/g, ' ');
}

export function tokenize(text: string): Token[] {
  return normalise(text).split(/\s+/).filter(Boolean).map((norm, i) => ({ raw: norm, norm, i }));
}

const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  a: 1, // "a thousand"
};
const EN_SCALES: Record<string, number> = { hundred: 100, thousand: 1000, tousand: 1000, thausand: 1000, k: 1000, million: 1_000_000, m: 1_000_000 };

// Scale-before-number languages.
const AF_SCALES: Record<string, number> = {
  dari: 100, dubu: 1000, miliyan: 1_000_000,                          // Hausa
  nari: 100, puku: 1000, nde: 1_000_000,                               // Igbo
  ogorun: 100, ogorunun: 100, egberun: 1000, egbarun: 1000,            // Yorùbá
};
const AF_UNITS: Record<string, number> = {
  // Hausa
  daya: 1, guda: 1, biyu: 2, uku: 3, hudu: 4, biyar: 5, shida: 6, bakwai: 7, takwas: 8, tara: 9, goma: 10,
  ashirin: 20, talatin: 30, arbain: 40, hamsin: 50, sittin: 60, sabain: 70, tamanin: 80, casain: 90, tisain: 90, tisin: 90,
  // Igbo
  otu: 1, abuo: 2, ato: 3, ano: 4, ise: 5, isii: 6, asaa: 7, asato: 8, itoolu: 9, iteghete: 9, iri: 10,
  // Yorùbá
  kan: 1, okan: 1, meji: 2, meta: 3, merin: 4, marun: 5, marunun: 5, mefa: 6, meje: 7, mejo: 8, mesan: 9, mesanan: 9,
  mewa: 10, mewaa: 10, mokanla: 11, mejila: 12, metala: 13, merinla: 14, meedogun: 15, merindinlogun: 16,
  metadinlogun: 17, mejidinlogun: 18, mokandinlogun: 19, ogun: 20, ogbon: 30, ogoji: 40, aadota: 50, ogota: 60,
  aadorin: 70, ogorin: 80, aadorun: 90,
};
const AF_STANDALONE: Record<string, number> = { egbaa: 2000, egbewa: 20000 }; // Yorùbá 2,000 / 20,000
const CONNECTORS = new Set(['sha', 'da', 'na', 'and', 'le', 'ati']);

function digitValue(tok: string): number | null {
  const m = tok.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] === 'k' ? v * 1000 : m[2] === 'm' ? v * 1_000_000 : v;
}
const isDigit = (t?: Token) => !!t && digitValue(t.norm) !== null;
const isEnNum = (t?: Token) => !!t && (t.norm in EN_UNITS || isDigit(t));
const isAfUnit = (t?: Token) => !!t && t.norm in AF_UNITS;

/** Small number after a Hausa/Igbo/Yorùbá scale word, e.g. "goma sha hudu" (14), "iri abuo na ise" (25). */
function parseAfSmall(toks: Token[], i: number): { value: number; next: number } | null {
  if (isDigit(toks[i])) return { value: digitValue(toks[i].norm)!, next: i + 1 };
  if (!isAfUnit(toks[i])) return null;
  let value = 0;
  let j = i;
  while (j < toks.length) {
    const t = toks[j];
    if (isAfUnit(t)) {
      let v = AF_UNITS[t.norm];
      // Igbo: "iri abuo" = 10 × 2
      if (t.norm === 'iri' && isAfUnit(toks[j + 1]) && AF_UNITS[toks[j + 1].norm] < 10) { v = 10 * AF_UNITS[toks[j + 1].norm]; j++; }
      value += v;
      j++;
      // connector followed by another unit continues the small number
      if (toks[j] && CONNECTORS.has(toks[j].norm) && (isAfUnit(toks[j + 1]) || isDigit(toks[j + 1]))) { j++; continue; }
      if (isAfUnit(toks[j])) continue;
      break;
    }
    break;
  }
  return { value, next: j };
}

function parseAt(toks: Token[], i: number): { value: number; next: number } | null {
  const t = toks[i];
  if (!t) return null;
  if (t.norm in AF_STANDALONE) return { value: AF_STANDALONE[t.norm], next: i + 1 };

  // Scale-first grammar (Hausa/Igbo/Yorùbá)
  if (t.norm in AF_SCALES) {
    let total = 0;
    let j = i;
    while (toks[j] && toks[j].norm in AF_SCALES) {
      const scale = AF_SCALES[toks[j].norm];
      const small = parseAfSmall(toks, j + 1);
      total += scale * (small ? small.value || 1 : 1);
      j = small ? small.next : j + 1;
      // "dubu biyar da dari biyar" -> + 500 ; "puku ise na nari ato"
      if (toks[j] && CONNECTORS.has(toks[j].norm) && toks[j + 1] && (toks[j + 1].norm in AF_SCALES)) { j++; continue; }
      if (toks[j] && CONNECTORS.has(toks[j].norm) && (isAfUnit(toks[j + 1]) || isDigit(toks[j + 1]))) {
        const tail = parseAfSmall(toks, j + 1);
        if (tail) { total += tail.value; j = tail.next; }
      }
      break;
    }
    return { value: total, next: j };
  }

  // Number-first grammar (English / Pidgin / digits)
  if (isEnNum(t)) {
    let total = 0, current = 0, j = i, seen = false;
    while (j < toks.length) {
      const w = toks[j].norm;
      if (isDigit(toks[j])) {
        if (seen && current !== 0 && !(toks[j - 1] && EN_SCALES[toks[j - 1].norm])) break; // "5200 3000" are two numbers
        if (seen && current === 0 && total > 0) break;                                      // "10 thousand 2 days" 
        current += digitValue(w)!;
      } else if (w in EN_UNITS && !(w === 'a' && !(toks[j + 1] && toks[j + 1].norm in EN_SCALES))) {
        if (seen && current % 10 !== 0 && EN_UNITS[w] < 10) break;
        current += EN_UNITS[w];
      } else if (w in EN_SCALES && seen) {
        const s = EN_SCALES[w];
        if (s === 100) current = (current || 1) * 100;
        else { total += (current || 1) * s; current = 0; }
      } else if (w === 'and' && seen && (isEnNum(toks[j + 1]))) {
        // "one thousand and fifty"
      } else break;
      seen = true;
      j++;
    }
    return seen ? { value: total + current, next: j } : null;
  }
  // African-language unit with an English scale after it ("biyar thousand") – code-switching
  if (isAfUnit(t) && toks[i + 1] && toks[i + 1].norm in EN_SCALES) {
    return { value: AF_UNITS[t.norm] * EN_SCALES[toks[i + 1].norm], next: i + 2 };
  }
  // Scale-first with digits: "dubu 5" handled above; "thousand 5" is not a pattern.
  return null;
}

export type Amount = { value: number; start: number; end: number };

/** All money-like amounts (≥ ₦50) in order of appearance, with token positions. */
export function extractAmounts(text: string, min = 50): Amount[] {
  const toks = tokenize(text);
  const out: Amount[] = [];
  let i = 0;
  while (i < toks.length) {
    const r = parseAt(toks, i);
    if (r && r.next > i) {
      if (r.value >= min) out.push({ value: Math.round(r.value), start: i, end: r.next });
      i = r.next;
    } else i++;
  }
  return out;
}

/** Does the amount appear in the transcript (tolerating ±1%)? */
export function amountSupported(amount: number, text: string): boolean {
  return extractAmounts(text, 1).some((a) => Math.abs(a.value - amount) <= Math.max(1, amount * 0.01));
}
