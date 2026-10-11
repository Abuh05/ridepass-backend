import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAmounts, amountSupported } from '../src/nlu/numbers.ts';
import { ruleExtract } from '../src/nlu/fallback.ts';
import { detectCommand } from '../src/nlu/keywords.ts';
import { validateExtraction, parseJsonLoose } from '../src/nlu/extract.ts';

const amounts = (s: string) => extractAmounts(s).map((a) => a.value);

test('English / Pidgin amounts', () => {
  assert.deepEqual(amounts('I made 14 thousand today, fuel 5,200, I paid owner 3,000'), [14000, 5200, 3000]);
  assert.deepEqual(amounts('I make fourteen thousand five hundred, fuel five thousand'), [14500, 5000]);
  assert.deepEqual(amounts('income 14k fuel 5.2k owner 3k'), [14000, 5200, 3000]);
  assert.deepEqual(amounts('I don make 10 thousand, 2 days ago'), [10000]);
  assert.deepEqual(amounts('₦12,500 income and N4000 fuel'), [12500, 4000]);
});
test('Hausa amounts', () => {
  assert.deepEqual(amounts('Yau na samu dubu goma sha huɗu, mai dubu biyar, na biya mai keke dubu uku'), [14000, 5000, 3000]);
  assert.deepEqual(amounts('na samu naira dubu biyar da dari biyar'), [5500]);
  assert.deepEqual(amounts('kuɗin mai dubu ashirin da biyar'), [25000]);
});
test('Igbo amounts', () => {
  assert.deepEqual(amounts('Enwetara m puku iri na anọ taa, mmanụ puku ise'), [14000, 5000]);
  assert.deepEqual(amounts('puku iri abuo na ise'), [25000]);
});
test('Yorùbá amounts', () => {
  assert.deepEqual(amounts('Mo pa ẹgbẹ̀rún mẹ́rìnlá lónìí, epo ẹgbẹ̀rún márùn-ún'), [14000, 5000]);
  assert.deepEqual(amounts('mo pa egbaa'), [2000]);
});
test('amount guard catches invented numbers', () => {
  assert.equal(amountSupported(14000, 'I made 14k today'), true);
  assert.equal(amountSupported(15000, 'I made 14k today'), false);
});
test('rule extractor assigns types in all languages', () => {
  const t = (s: string) => ruleExtract(s).entries.map((e) => `${e.type}:${e.amount}`).join(' ');
  assert.equal(t('I made 14 thousand today, fuel 5,200, I paid owner 3,000'), 'income:14000 fuel:5200 owner_payment:3000');
  assert.equal(t('Yau na samu dubu goma sha huɗu, mai dubu biyar, na biya mai keke dubu uku'), 'income:14000 fuel:5000 owner_payment:3000');
  assert.equal(t('Mo pa ẹgbẹ̀rún mẹ́rìnlá lónìí, epo ẹgbẹ̀rún márùn-ún, mo san ẹgbẹ̀rún mẹ́ta fún olówó ọkọ̀'), 'income:14000 fuel:5000 owner_payment:3000');
  assert.equal(t('yesterday I work 12k, 4000 for fuel, ticket 500, mechanic 2500'), 'income:12000 fuel:4000 levy:500 repair:2500');
  assert.equal(ruleExtract('jiya na samu dubu goma').day, 'yesterday');
});
test('commands are exact and short', () => {
  assert.equal(detectCommand('PASSPORT'), 'passport');
  assert.equal(detectCommand('delete my data'), 'delete');
  assert.equal(detectCommand('I paid owner 3000 for the passport photo'), null);
});
test('LLM output validation', () => {
  assert.deepEqual(validateExtraction(parseJsonLoose('```json\n{"intent":"log","day":"today","entries":[{"type":"fuel","amount":5000}]}\n```'))?.entries, [{ type: 'fuel', amount: 5000 }]);
  assert.equal(validateExtraction({ intent: 'log', day: 'today', entries: [{ type: 'lottery', amount: 5 }] }), null);
  assert.equal(validateExtraction(parseJsonLoose('sorry I cannot')), null);
});
