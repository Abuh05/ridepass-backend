# RidePass — voice-first credit passport for Nigerian commercial riders

**NAIC 2026 · Problem Statement 2 (Voice-First Access) · Track B (Innovation & Enterprise) · Phoenix Renewable Group**

Keke, okada and bus riders earn cash every day but have no records, so lenders can't assess them and they end up in exploitative hire-purchase deals. RidePass lets a rider **send a WhatsApp voice note in English, Pidgin, Hausa, Yorùbá or Igbo** ("I made 14 thousand today, fuel 5,200, I paid owner 3,000"). The note is:

1. transcribed by the **official N-ATLAS ASR model** for that language (NCAIR1 Hausa/Yoruba/Igbo/Nigerian-English),
2. turned into structured ledger entries by **N-ATLaS** (constrained JSON, cross-checked by a multilingual number parser),
3. **read back to the rider for confirmation**. Nothing is saved without a "Correct",
4. written to a **hash-chained ledger**, and every payment to the owner is **confirmed by the owner**: from their own WhatsApp number, or on a link with an owner PIN set in person, so a rider can never confirm their own payment.

After 14 active days, the rider gets a **signed credit passport** (Ed25519) with an explainable, behaviour-only score. They share it with a lessor or lender by code or in-app approval. Lessors get a **daily repayment portfolio**, and Phoenix gets an **EV-switch estimate** built from the rider's own fuel spend.

```
Rider (WhatsApp / web / field agent)
   │ voice note (ogg/webm)
   ▼
RidePass app (Node 22, zero dependencies) ──► N-ATLAS model service (GPU)
   │  job queue · consent · state machine        ├─ /asr   NCAIR1/{Hausa,Yoruba,Igbo}-ASR, NigerianAccentedEnglish
   │  number parser guard · anomaly checks       └─ vLLM   NCAIR1/N-ATLaS (schema-constrained JSON, money coach)
   │  hash-chained ledger · owner attestations
   │  score · signed passport · audit log
   ▼
Lessor / lender dashboard · share-code page · public verifier
```

## Live pilot

| | |
|---|---|
| Website, rider app, dashboards | https://credit-passport-tau.vercel.app (`/rider`, `/agent`, `/dashboard`, `/verify`, `/admin`) |
| Getting-started guide (every role) | https://credit-passport-tau.vercel.app/guide |
| Privacy notice | https://credit-passport-tau.vercel.app/privacy |
| API server | https://ridepass-production.up.railway.app (`/health`) |
| Models | NCAIR1 ASR (en/ha/yo/ig) + NCAIR1/N-ATLaS on a RunPod A40 GPU |

## Repository

| Path | What |
|---|---|
| `model-service/` | Python service for the GPU: N-ATLAS ASR API + vLLM for N-ATLaS, Dockerfile, `start.sh`, WER benchmark |
| `app/src/` | Node/TypeScript app (runs on Node ≥ 22.13 with **no npm install**) |
| `app/public/` | Landing page, rider web app, field-agent app, lessor/lender dashboard, admin console, guide, privacy notice, share page, owner confirmation page, verifier |
| `app/test/` | 39 automated tests (numbers in 5 languages, full conversation flows, tamper detection, daily ledger anchors, N-ATLAS API contract, owner-PIN verification, hallucination guards) |
| `app/bench/` | Labelled extraction benchmark (N-ATLaS vs rule baseline). Grow it with real pilot transcripts |
| `docs/` | Gaps & mitigations, architecture, deployment, pilot protocol, data protection, WhatsApp templates, submission checklist |

## Quick start (laptop, no GPU: UI only)

```bash
cd app
npm test                              # 39 tests
npm run simulate                      # builds data/demo.db with synthetic riders + prints API keys
DB_PATH=./data/demo.db MODEL_MODE=mock npm start
# open http://localhost:8080  →  /dashboard  /rider  /agent  /verify
```
On Windows PowerShell: `$env:DB_PATH="./data/demo.db"; $env:MODEL_MODE="mock"; npm start`

> `MODEL_MODE=mock` bypasses N-ATLAS and is **only** for UI work. Interactions logged in mock mode are excluded from validation metrics. The pilot must run with `MODEL_MODE=natlas`.

## Going live
See **docs/DEPLOY.md**: rent a 24 GB GPU → `model-service/start.sh`, deploy `app/` (Railway/VPS), connect the WhatsApp webhook, create lessor/lender/agent keys, and run the pilot in **docs/PILOT_PROTOCOL.md**.

## Key commands (riders)
Voice note = log money · `SUMMARY` · `PASSPORT` · `EV` · `STOP SHARING` · `MY DATA` · `DELETE MY DATA` · `LANGUAGE` · `PIN` · `HELP`
