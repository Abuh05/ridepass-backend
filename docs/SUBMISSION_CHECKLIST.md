# NAIC 2026 submission checklist: RidePass

**Deadline: 12 October 2026, 23:59 WAT. Submit by 11 October.**
Track B (Innovation & Enterprise) · Problem Statement 2: Voice-First Access

## Eligibility

- [ ] 2–5 team members, all Nigerian citizens. At least 50% of any diaspora team must be based in Nigeria.
- [ ] Phoenix Renewable Group CAC certificate, or a valid ID for each individual
- [ ] Not previously awarded in another competition
- [ ] Voice input uses the **official N-ATLAS ASR**. The model IDs are logged on every interaction (`asr_model`).

## Required materials, and where each one comes from

| # | Requirement | Our evidence |
|---|---|---|
| 1 | Working artefact | https://credit-passport-tau.vercel.app (rider web, agent, dashboard, verifier, admin, guide) + API at https://ridepass-production.up.railway.app + GitHub repo `Abuh05/ridepass-backend` (+ WhatsApp number once Meta verification completes) |
| 2 | N-ATLAS integration evidence | `model-service/app.py` (4 NCAIR1 ASR models), `start.sh` (vLLM serving NCAIR1/N-ATLaS), `app/src/models.ts` and `nlu/extract.ts`, the contract test, and the `model_path` / `asr_model` columns in `evidence/interactions.csv` |
| 3 | Real-world validation | `evidence/metrics.json` + `interactions.csv` from the pilot, WER per language, `bench:nlu` results, lender observer letter, rider testimonials |
| 4 | Technical documentation | `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, `docs/GAPS_AND_MITIGATIONS.md`, `docs/DATA_PROTECTION.md` |
| 5 | 3–5 min video | Script below |
| 6 | Team profile | Names, roles, affiliations |
| 7 | Registration | CAC certificate / IDs |

## How we answer each judging criterion

| Criterion | Our strongest proof |
|---|---|
| Working artefact & technical rigour | Real WhatsApp voice flow in 5 languages. 44 automated tests. Hash-chained ledger and Ed25519-signed passports with a public verifier. Persistent job queue with retries. Zero-dependency deployment. |
| N-ATLAS integration | Official ASR for **all four** languages. N-ATLaS for structured extraction (schema-constrained) **and** as a money coach in the rider's language. Guard-rails measured, not hidden (`natlas` vs `natlas_guarded` vs `fallback` share reported). |
| Real-world validation | 30 riders, 300+ voice interactions, first-pass accuracy by language, WER on native-speaker-labelled clips, owner confirmation rate, satisfaction score, lender feedback |
| Impact potential | 93% of Nigerian workers are informal. Riders are locked out of fair finance. ELRA/NATOMORAS launched a leasing scheme in April 2026 that needs exactly this risk data. |
| Scalability & sustainability | Revenue: lessor portfolio fee per rider per month, per-passport pulls for lenders, EV-conversion financing leads for Phoenix. Scale path: commercial N-ATLAS licence beyond 1,000 users (a guard is built in), IVR/USSD for feature phones, Postgres. |
| Team capability | Phoenix mobility and EV conversion expertise, plus an existing relationship with riders through EV training |

## Video script (4:30)

1. **0:00–0:30 · The problem.** Footage of a keke park: "Musa pays ₦3,000 a day to his owner, and has for two years. No bank knows."
2. **0:30–1:45 · Live demo on a real phone.**
   - A Hausa voice note → "Na ji: Kuɗin shiga ₦14,000…" → tap *Daidai ne* → Saved.
   - The owner's phone gets a confirm button → the owner taps Yes.
   - Show a Yorùbá rider too.
3. **1:45–2:30 · Under the hood.**
   - Diagram: WhatsApp → NCAIR1 Hausa-ASR → N-ATLaS (JSON) → number-parser guard → read-back → hash-chained ledger.
   - Show `/api/admin/metrics`: model paths, latencies, per-language accuracy.
4. **2:30–3:15 · The passport.**
   - Rider sends PASSPORT → gets a share code. The lender opens it → score, reasons, affordability check.
   - Tamper demo: edit the database → the verifier shows ✖ ledger changed.
   - (Label the scored passport as demo data if pilot riders haven't reached 14 days.)
5. **3:15–3:50 · Lessor dashboard.** The repayment calendar and missed-payment alert. Then EV: "Switching would save you ₦X/month", and the lead goes to Phoenix.
6. **3:50–4:30 · Validation and business.** Pilot numbers, lender quote, revenue model, NDPA controls, and the ask: a pilot with ELRA or a leasing firm.

## Final checks (10–11 Oct)

- [ ] `MODEL_MODE=natlas` in production (done); start the RunPod GPU, then `/admin` → System status shows both models Reachable
- [ ] `npm run export:interactions`: evidence contains **no** mock or demo data
- [ ] Native speakers reviewed the Hausa, Yorùbá, Igbo and Pidgin strings in `app/src/i18n.ts`
- [ ] Audio clips recorded for `consent`, `ask_name`, `ready` in each language (`app/public/audio/`)
- [x] Privacy notice (`/privacy`) linked from the landing page, rider login and owner page. Contact email: creditpassport@gmail.com (`CONTACT` in `app/public/common.js`)
- [x] Repo public at https://github.com/Abuh05/ridepass-backend. Secret scan of the full history done 12 Oct: no `.env`, keys or tokens committed

## Submission documents in this repo

- `docs/VALIDATION.md`: field-day results with real numbers (and what is not yet shown)
- `docs/JUDGES.md`: how judges can test the live system with the judges' keys (WhatsApp is pending)
