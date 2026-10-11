// Keyword lexicons (diacritics stripped, lower-case) for the five supported languages.
import { normalise } from './numbers.ts';

export const ENTRY_TYPES = ['income', 'fuel', 'charging', 'owner_payment', 'loan_repayment', 'repair', 'levy', 'savings', 'other_expense'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const EXPENSE_TYPES: EntryType[] = ['fuel', 'charging', 'repair', 'levy', 'other_expense'];
export const REPAYMENT_TYPES: EntryType[] = ['owner_payment', 'loan_repayment'];

// Multi-word phrases are checked before single words ("mai keke" = owner, "mai" alone = fuel in Hausa).
const LEX: Record<EntryType, string[]> = {
  owner_payment: ['mai keke', 'mai mota', 'mai babur', 'mai abin hawa', 'mai adaidaita', 'olowo oko', 'olowo', 'onye nwe', 'nwe ugbo',
    'owner', 'oga', 'delivery', 'remit', 'remittance', 'daily pay', 'balance owner'],
  loan_repayment: ['hire purchase', 'loan', 'repay', 'repayment', 'installment', 'instalment', 'bashi', 'gbese', 'lease'],
  income: ['made', 'make', 'earn', 'earned', 'gain', 'collected', 'income', 'sales', 'worked', 'work', 'got', 'get', 'samu',
    'kudin shiga', 'mo pa', 'owo ti mo pa', 'nwetara', 'enwetara', 'kpatara', 'ritere'],
  fuel: ['fuel', 'petrol', 'pms', 'gas', 'fetur', 'mai', 'epo', 'mmanu', 'diesel'],
  charging: ['charge', 'charging', 'battery', 'swap', 'caji', 'chaji'],
  repair: ['repair', 'mechanic', 'spare', 'part', 'parts', 'tyre', 'tire', 'vulcanizer', 'vulcaniser', 'engine oil', 'service',
    'gyara', 'atunse', 'mmezi', 'mekaniki', 'makaniki'],
  levy: ['ticket', 'levy', 'union', 'agbero', 'task force', 'tax', 'haraji', 'tikiti', 'levi', 'tiketi', 'dues'],
  savings: ['save', 'saved', 'saving', 'savings', 'ajo', 'esusu', 'adashe', 'ajiya', 'isusu', 'nchekwa', 'ifowopamo'],
  other_expense: ['food', 'chop', 'abinci', 'ounje', 'nri', 'phone', 'recharge', 'airtime', 'data', 'police', 'fine'],
};
const YESTERDAY = ['yesterday', 'yesterdey', 'jiya', 'ana', 'lana', 'unyahu', 'nyahu'];

type Hit = { type: EntryType; pos: number; len: number; weak?: boolean };
// Generic verbs ("collected", "got") lose to a specific keyword in the same span: "task force collected 1000" = levy.
const WEAK = new Set(['collected', 'collect', 'got', 'get', 'gain']);

/** Find keyword hits with their token positions. */
export function keywordHits(text: string): Hit[] {
  const toks = normalise(text).split(/\s+/).filter(Boolean);
  const hits: Hit[] = [];
  const used = new Set<number>();
  for (const len of [3, 2, 1]) {
    for (let i = 0; i + len <= toks.length; i++) {
      if ([...Array(len).keys()].some((k) => used.has(i + k))) continue;
      const phrase = toks.slice(i, i + len).join(' ');
      for (const type of Object.keys(LEX) as EntryType[]) {
        if (LEX[type].includes(phrase)) {
          hits.push({ type, pos: i, len, weak: WEAK.has(phrase) });
          for (let k = 0; k < len; k++) used.add(i + k);
          break;
        }
      }
    }
  }
  return hits.sort((a, b) => a.pos - b.pos);
}

export function mentionsYesterday(text: string): boolean {
  const toks = normalise(text).split(/\s+/);
  return YESTERDAY.some((w) => toks.includes(w));
}

export type Command = 'stop_reminders' | 'summary' | 'passport' | 'ev' | 'help' | 'stop_sharing' | 'my_data' | 'delete' | 'language' | 'pin' | 'hi';
const COMMANDS: [Command, string[]][] = [
  ['delete', ['delete my data', 'delete my account', 'goge bayanai', 'pa data mi re', 'hichapu data m']],
  ['stop_sharing', ['stop sharing', 'stop share', 'dakatar da rabawa']],
  ['stop_reminders', ['stop', 'stop reminders', 'stop reminder', 'no reminders']],
  ['my_data', ['my data', 'download my data', 'export']],
  ['summary', ['summary', 'report', 'my week', 'takaitawa', 'akopo', 'nchikota', 'balance']],
  ['passport', ['passport', 'my score', 'score', 'credit']],
  ['ev', ['ev', 'electric', 'lantarki', 'eletrik', 'ina manamana']],
  ['help', ['help', 'menu', 'taimako', 'iranlowo', 'enyemaka', '?']],
  ['language', ['language', 'change language', 'harshe', 'ede', 'asusu']],
  ['pin', ['pin', 'web pin', 'set pin']],
  ['hi', ['hi', 'hello', 'hey', 'start', 'sannu', 'bawo', 'ndewo', 'kedu', 'how far']],
];
/** Exact short commands only (so "I paid owner..." is never mistaken for a command). */
export function detectCommand(text: string): Command | null {
  const n = normalise(text).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || n.split(' ').length > 4) return null;
  for (const [cmd, words] of COMMANDS) if (words.includes(n)) return cmd;
  return null;
}
