// Interaction log = the real-world validation evidence for NAIC (≥ 50 documented interactions).
import { all, one, run } from './db.ts';
import { nowIso, uid } from './util.ts';

export type InteractionIn = {
  userId?: string | null; channel: string; direction: 'in' | 'out'; kind: string; lang?: string | null; text?: string | null;
  transcript?: string | null; audioSeconds?: number | null; asrMs?: number | null; llmMs?: number | null; asrModel?: string | null;
  modelPath?: string | null; intent?: string | null; extracted?: unknown; externalId?: string | null;
};

export function logInteraction(i: InteractionIn): string {
  const id = uid();
  run(`INSERT INTO interactions (id,user_id,channel,direction,kind,lang,text,transcript,audio_seconds,asr_ms,llm_ms,asr_model,model_path,intent,extracted,external_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, i.userId ?? null, i.channel, i.direction, i.kind, i.lang ?? null, i.text ?? null, i.transcript ?? null, i.audioSeconds ?? null,
    i.asrMs ?? null, i.llmMs ?? null, i.asrModel ?? null, i.modelPath ?? null, i.intent ?? null,
    i.extracted === undefined ? null : JSON.stringify(i.extracted), i.externalId ?? null, nowIso());
  return id;
}
export function updateInteraction(id: string, fields: { transcript?: string; asrMs?: number; llmMs?: number; asrModel?: string; modelPath?: string; intent?: string; extracted?: unknown; audioSeconds?: number; lang?: string }): void {
  const map: Record<string, string> = { transcript: 'transcript', asrMs: 'asr_ms', llmMs: 'llm_ms', asrModel: 'asr_model', modelPath: 'model_path', intent: 'intent', extracted: 'extracted', audioSeconds: 'audio_seconds', lang: 'lang' };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    run(`UPDATE interactions SET ${map[k]} = ? WHERE id = ?`, k === 'extracted' ? JSON.stringify(v) : (v as any), id);
  }
}
export function setOutcome(id: string, outcome: 'confirmed' | 'corrected' | 'cancelled'): void {
  run('UPDATE interactions SET outcome = ? WHERE id = ?', outcome, id);
}
export function seenExternal(externalId: string): boolean {
  return !!one('SELECT 1 FROM interactions WHERE external_id = ?', externalId);
}

/** Validation metrics for the submission (mock-mode interactions excluded). */
export function metrics() {
  const q = (sql: string, ...p: any[]) => all(sql, ...p);
  const real = `model_path IS NULL OR model_path != 'mock'`;
  return {
    riders: one(`SELECT COUNT(*) c FROM users WHERE role='rider' AND consent_at IS NOT NULL AND status != 'deleted'`)?.c,
    owners_confirming: one(`SELECT COUNT(DISTINCT owner_id) c FROM attestations WHERE status != 'pending'`)?.c,
    interactions_in: one(`SELECT COUNT(*) c FROM interactions WHERE direction='in' AND (${real})`)?.c,
    voice_notes: one(`SELECT COUNT(*) c FROM interactions WHERE direction='in' AND kind='audio' AND (${real})`)?.c,
    by_language: q(`SELECT lang, COUNT(*) n, ROUND(AVG(asr_ms)) avg_asr_ms, ROUND(AVG(llm_ms)) avg_llm_ms,
                    SUM(outcome='confirmed') confirmed, SUM(outcome='corrected') corrected
                    FROM interactions WHERE direction='in' AND kind='audio' AND (${real}) GROUP BY lang`),
    by_model_path: q(`SELECT model_path, COUNT(*) n FROM interactions WHERE direction='in' AND model_path IS NOT NULL GROUP BY model_path`),
    first_pass_accuracy: one(`SELECT ROUND(100.0*SUM(outcome='confirmed')/NULLIF(SUM(outcome IN ('confirmed','corrected')),0),1) pct
                              FROM interactions WHERE direction='in' AND intent='log' AND (${real})`)?.pct,
    attestations: q(`SELECT status, COUNT(*) n FROM attestations GROUP BY status`),
    satisfaction: one(`SELECT ROUND(AVG(rating),2) avg, COUNT(*) n FROM feedback`),
    entries: one(`SELECT COUNT(*) c FROM entries WHERE type != 'void'`)?.c,
    passports_issued: one(`SELECT COUNT(*) c FROM passports`)?.c,
    ev_leads: one(`SELECT COUNT(*) c FROM ev_leads`)?.c,
  };
}
