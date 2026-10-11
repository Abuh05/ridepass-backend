// Clients for the N-ATLAS stack: NCAIR1 ASR models (model-service /asr) and NCAIR1/N-ATLaS (vLLM, OpenAI-compatible).
import { config } from './config.ts';

export type AsrResult = { text: string; ms: number; model: string; seconds: number };
export class ModelError extends Error {
  kind: 'unavailable' | 'bad_audio' | 'too_long';
  constructor(msg: string, kind: 'unavailable' | 'bad_audio' | 'too_long') { super(msg); this.kind = kind; }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fn(ac.signal); } finally { clearTimeout(timer); }
}

/**
 * Whisper-style models loop on silence or noise ("ƙanar ƙanar ƙanar …"). Such a transcript means
 * the rider wasn't heard, so ask them to record again instead of extracting from it.
 */
export function looksDegenerate(text: string): boolean {
  const toks = text.toLowerCase().split(/[\s.,!?]+/).filter(Boolean);
  if (toks.length < 8) return false;
  let run = 1;
  for (let i = 1; i < toks.length; i++) { run = toks[i] === toks[i - 1] ? run + 1 : 1; if (run >= 6) return true; }
  return new Set(toks).size / toks.length < 0.25;
}

/** Transcribe with the official N-ATLAS ASR model for the language. */
export async function transcribe(audio: Buffer, mime: string, asrLang: 'en' | 'ha' | 'yo' | 'ig', mockTranscript?: string): Promise<AsrResult> {
  if (config.modelMode === 'mock') {
    if (!mockTranscript) throw new ModelError('mock mode: no transcript supplied', 'unavailable');
    return { text: mockTranscript, ms: 0, model: 'mock', seconds: 0 };
  }
  const t0 = Date.now();
  const form = new FormData();
  form.append('language', asrLang);
  form.append('file', new Blob([audio], { type: mime || 'application/octet-stream' }), 'voice');
  let res: Response;
  try {
    res = await withTimeout(config.asrTimeoutMs, (signal) => fetch(`${config.asrUrl}/asr`, {
      method: 'POST', body: form, signal, headers: { Authorization: `Bearer ${config.modelToken}` },
    }));
  } catch (e) {
    throw new ModelError(`ASR unreachable: ${(e as Error).message}`, 'unavailable');
  }
  if (res.status === 413) throw new ModelError('audio too long', 'too_long');
  if (res.status === 422) throw new ModelError(await res.text(), 'bad_audio');
  if (!res.ok) throw new ModelError(`ASR ${res.status}: ${await res.text()}`, 'unavailable');
  const j = await res.json() as { text: string; model: string; audio_seconds: number };
  return { text: j.text, ms: Date.now() - t0, model: j.model, seconds: j.audio_seconds };
}

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

/** Chat completion against N-ATLaS served by vLLM. `schema` enables constrained JSON decoding. */
export async function chat(messages: ChatMsg[], opts: { schema?: object; maxTokens?: number; temperature?: number } = {}): Promise<{ text: string; ms: number }> {
  if (config.modelMode === 'mock') throw new ModelError('mock mode: LLM disabled', 'unavailable');
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: config.llmModel,
    messages,
    max_tokens: opts.maxTokens ?? 300,
    temperature: opts.temperature ?? 0,
  };
  // OpenAI-standard structured output; vLLM enforces the schema during decoding (works on vLLM ≥ 0.6).
  if (opts.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'ridepass_extraction', schema: opts.schema } };
  let res: Response;
  try {
    res = await withTimeout(config.llmTimeoutMs, (signal) => fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.modelToken}` },
      body: JSON.stringify(body),
    }));
  } catch (e) {
    throw new ModelError(`LLM unreachable: ${(e as Error).message}`, 'unavailable');
  }
  if (!res.ok) throw new ModelError(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`, 'unavailable');
  const j = await res.json() as { choices: { message: { content: string } }[] };
  return { text: j.choices?.[0]?.message?.content ?? '', ms: Date.now() - t0 };
}

export async function modelHealth(): Promise<{ asr: boolean; llm: boolean; detail: unknown }> {
  if (config.modelMode === 'mock') return { asr: false, llm: false, detail: 'mock mode' };
  const out = { asr: false, llm: false, detail: {} as Record<string, unknown> };
  try {
    const r = await withTimeout(5000, (s) => fetch(`${config.asrUrl}/health`, { signal: s }));
    out.asr = r.ok; out.detail.asr = await r.json();
  } catch (e) { out.detail.asr = String(e); }
  try {
    const r = await withTimeout(5000, (s) => fetch(`${config.llmBaseUrl}/models`, { signal: s, headers: { Authorization: `Bearer ${config.modelToken}` } }));
    out.llm = r.ok; out.detail.llm = await r.json();
  } catch (e) { out.detail.llm = String(e); }
  return out;
}
