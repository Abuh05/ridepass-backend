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
| `attest.ts` | Owner confirmations by WhatsApp button, template, or link; owner PIN checks and lockout |
| `scoring.ts` | 0–100 score: consistency 25, repayment 25, stability 20, verification 15, affordability 10, tenure 5, minus anomaly penalties |
| `passport.ts` | Ed25519-signed passport; verification re-checks signature, expiry, and the ledger head |
| `grants.ts` | Consents, per-organisation grants, share codes, access audit log |
| `ev.ts` | EV-switch estimate from the rider's own logged fuel spend |
| `jobs.ts` | Persistent queue that survives restarts and GPU downtime |
| `channels/` | WhatsApp Cloud API, web outbox; one `send()` for everything |

## Trust model

- **The rider cannot silently rewrite history.** Entries are append-only and hash-chained, and corrections are new `void` entries. A passport signs the chain head, so later edits make verification fail.
- **The rider cannot confirm their own repayments.** A payment counts as owner-confirmed only when the owner provably answered: from the owner's own WhatsApp number (button replies from anyone else are ignored), or on the web link **with the owner's PIN**. Owners get that PIN when a field agent verifies them in person (ID and vehicle papers) or when their lessor registers the collection phone. Five wrong PINs lock it for 24 hours. A "Yes" on the link without a PIN is recorded but not counted; a "Not correct" always counts. Confirmations from owners who are not verified carry 80% weight.
- **Silent recordings can't create entries.** The browser blocks notes where the microphone heard nothing, the model service rejects near-silent audio, looping (hallucinated) transcripts are treated as unheard, and any amount N-ATLaS returns that is not in the transcript is dropped.
- **An operator with database access** could rebuild a whole chain. Every day at 23:00 Lagos time the app computes a **Merkle root over all riders' chain heads** (pseudonymous rider refs, no personal data) and publishes it at `GET /api/anchors`; `GET /api/anchors/:day/proof/:ref` returns a rider's inclusion proof. Anyone who saved a root (for example a lender, alongside a passport) can later detect a rebuilt history. Remaining step: also post each root somewhere the operator does not control (e.g. a public repository commit), so the published roots themselves cannot be rewritten.
- **Who recorded each entry** (rider by voice, typed, or with a field agent) is part of each entry's hash, and the passport shows the breakdown to lenders. Nothing can tell *which person* spoke: RidePass deliberately does not use voice biometrics (sensitive data under the NDPA, and unreliable in noisy parks). Repayments still need the owner's own confirmation.
- **Lenders** only see what the rider approved, and every view is logged and shown to the rider in `MY DATA`.

## Deployment (pilot)

| Part | Where | Notes |
|---|---|---|
| Web pages | Vercel (`credit-passport-tau.vercel.app`) | Static files from `app/public`; `vercel.json` proxies `/api`, `/webhook` and `/.well-known` to Railway |
| App + SQLite | Railway (`ridepass-production.up.railway.app`) | Dockerfile in `app/`, volume at `/app/data` |
| N-ATLAS models | RunPod A40 (48 GB) | `model-service/start.sh`: NCAIR1 ASR on :9000, vLLM N-ATLaS on :8000, both behind `MODEL_SERVICE_TOKEN` |

## Scaling path

SQLite handles the pilot, up to the 1,000-user licence cap. After that: Postgres (the schema ports directly), several app instances behind a load balancer, and a Redis-based queue. The model service scales horizontally behind a load balancer; ASR is the cheap part.
