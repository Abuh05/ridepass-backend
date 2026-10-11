# Architecture

## Voice note → confirmed ledger entry

```
WhatsApp webhook ──(HMAC verified, ack < 100 ms)──► jobs table (SQLite, per-rider ordering, retries with back-off)
                                                          │
                                  handleInbound(): dedupe by message id → rate limit → state machine
                                                          │ audio
                        download media ──► model-service /asr  (NCAIR1 ASR for rider's language, 30 s chunks)
                                                          │ transcript
                          nlu/extract.ts ──► N-ATLaS (vLLM, json_schema-constrained, few-shot in 5 languages)
                                  │                 │
                                  │     validate → every amount must appear in transcript (numbers.ts: en/pcm/ha/yo/ig)
                                  │                 │ fail → rule extractor (fallback.ts); path logged
                                  ▼
                         read-back in rider's language + [Correct] [Not correct]
                                  │ Correct
               anomalies.ts flags → ledger.ts appendEntries (seq, prev_hash, sha256) → attestation to owner
```

## Main modules (`app/src`)

| Module | Responsibility |
|---|---|
| `flow.ts` | Conversation state machine: onboarding, consent, logging, commands, grant decisions |
| `nlu/numbers.ts` | Money parser for English/Pidgin (scale after the number) and Hausa/Igbo/Yorùbá (scale before the number) |
| `nlu/extract.ts` | N-ATLaS prompt, schema, validation, hallucination guard |
| `ledger.ts` | Append-only hash chain, void entries, chain verification |
| `attest.ts` | Owner confirmations by WhatsApp button, template, or signed link |
| `scoring.ts` | 0–100 score: consistency 25, repayment 25, stability 20, verification 15, affordability 10, tenure 5, minus anomaly penalties |
| `passport.ts` | Ed25519-signed passport; verification re-checks signature, expiry, and the ledger head |
| `grants.ts` | Consents, per-organisation grants, share codes, access audit log |
| `ev.ts` | EV-switch estimate from the rider's own logged fuel spend |
| `jobs.ts` | Persistent queue that survives restarts and GPU downtime |
| `channels/` | WhatsApp Cloud API, web outbox; one `send()` for everything |

## Trust model

- **The rider cannot silently rewrite history.** Entries are append-only and hash-chained, and corrections are new `void` entries. A passport signs the chain head, so later edits make verification fail.
- **The rider cannot inflate repayments** without the owner disputing them. Owners registered by a lessor or field agent carry full weight; self-declared owners carry 80%.
- **An operator with database access** could rebuild the whole chain. The mitigation for scale is to publish a daily Merkle root of all chain heads (for example to a public log) so that past states become externally auditable. This is on the roadmap.
- **Lenders** only see what the rider approved, and every view is logged and shown to the rider in `MY DATA`.

## Scaling path

SQLite handles the pilot, up to the 1,000-user licence cap. After that: Postgres (the schema ports directly), several app instances behind a load balancer, and a Redis-based queue. The model service scales horizontally behind a load balancer; ASR is the cheap part.
