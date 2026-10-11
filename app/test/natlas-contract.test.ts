// Contract test: exercises the real HTTP clients against a stub that speaks the same protocol as
// vLLM (OpenAI-compatible, json_schema) and the model-service /asr endpoint.
process.env.NODE_TEST = '1';
process.env.MODEL_MODE = 'natlas';
process.env.MODEL_SERVICE_TOKEN = 'tok';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const seen: any[] = [];
const stub = createServer((req, res) => {
  let body = Buffer.alloc(0);
  req.on('data', (c) => (body = Buffer.concat([body, c])));
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: body.toString('latin1') });
    if (req.url === '/v1/chat/completions') {
      const j = JSON.parse(body.toString());
      const last = j.messages.at(-1).content as string;
      let content = '{"intent":"log","day":"today","entries":[{"type":"income","amount":14000},{"type":"fuel","amount":5000}]}';
      if (last.includes('INVENT')) content = '{"intent":"log","day":"today","entries":[{"type":"income","amount":99000}]}';
      if (last.includes('GARBAGE')) content = 'I am not sure what you mean';
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } else if (req.url === '/asr') {
      const lang = body.toString('latin1').match(/name="language"\r\n\r\n(\w+)/)?.[1];
      res.end(JSON.stringify({ text: `transcript-${lang}`, model: `NCAIR1/${lang}`, audio_seconds: 4.2, latency_ms: 300 }));
    } else { res.statusCode = 404; res.end(); }
  });
});
await new Promise<void>((r) => stub.listen(0, r));
const port = (stub.address() as any).port;
process.env.LLM_BASE_URL = `http://localhost:${port}/v1`;
process.env.ASR_URL = `http://localhost:${port}`;
const { extract } = await import('../src/nlu/extract.ts');
const { transcribe, looksDegenerate } = await import('../src/models.ts');
after(() => stub.close());

test('N-ATLaS extraction uses constrained JSON and auth', async () => {
  const r = await extract('I made 14k fuel 5000');
  assert.equal(r.path, 'natlas');
  assert.deepEqual(r.entries, [{ type: 'income', amount: 14000 }, { type: 'fuel', amount: 5000 }]);
  const call = seen.find((s) => s.url === '/v1/chat/completions');
  assert.equal(call.auth, 'Bearer tok');
  assert.equal(JSON.parse(call.body).response_format.type, 'json_schema', 'schema-constrained decoding requested');
});
test('guard replaces amounts N-ATLaS invented', async () => {
  const r = await extract('INVENT I made 14k');
  assert.equal(r.path, 'natlas_guarded');
  assert.deepEqual(r.entries, [{ type: 'income', amount: 14000 }]);
  assert.equal(r.lowConfidence, true);
});
test('guard drops invented amounts when the rider said no numbers', async () => {
  const r = await extract('INVENT king sunny ade rhythms are the heartbeat of nigeria');
  assert.equal(r.path, 'natlas_guarded');
  assert.deepEqual(r.entries, [], 'an amount the rider never said must not be shown');
});
test('unparseable LLM output falls back to rules', async () => {
  const r = await extract('GARBAGE I made 14k');
  assert.equal(r.path, 'fallback');
  assert.deepEqual(r.entries, [{ type: 'income', amount: 14000 }]);
});
test('looping ASR output on silence is detected; real notes are not', () => {
  assert.equal(looksDegenerate('ƙarar ' + 'ƙanar '.repeat(80)), true);
  assert.equal(looksDegenerate('i made 14,000 naira today. fuel was 5,200. i paid the owner 3,000.'), false);
  assert.equal(looksDegenerate('Jiya na samu dubu goma sha biyu, mai dubu hudu, haraji dari biyar'), false);
  assert.equal(looksDegenerate('dubu dubu biyu'), false, 'short notes are never flagged');
});
test('ASR request carries language and audio', async () => {
  const r = await transcribe(Buffer.from('fake-ogg'), 'audio/ogg', 'yo');
  assert.equal(r.text, 'transcript-yo');
  assert.equal(r.seconds, 4.2);
  const call = seen.find((s) => s.url === '/asr');
  assert.match(call.body, /fake-ogg/);
  assert.equal(call.auth, 'Bearer tok');
});
