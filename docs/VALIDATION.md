# Real-world validation: first field day (12 October 2026)

All figures come from the live production system (`MODEL_MODE=natlas`) at
https://credit-passport-tau.vercel.app, exported from the interaction log (`/api/admin/interactions.csv`)
and the database on 12 Oct 2026 at 16:50 WAT. No mock or synthetic data is included
(the export contains 0 mock rows). Test traffic from before the field day was removed with
`npm run reset:activity` (a backup was kept).

## What happened

| Measure | Value |
|---|---|
| Period | 12 Oct 2026, 14:06–16:49 WAT |
| Rider accounts created (all with recorded consent) | 8 (3 later used **DELETE MY DATA**, so their profiles and transcripts were erased as designed) |
| Rider messages received | 154 (51 voice notes, 52 typed, 51 button taps) |
| Channel | Rider web app and field-agent app (WhatsApp is pending Meta business verification) |
| Voice notes by language | Pidgin 30 · Hausa 18 · English 3 |
| Speech models used | NCAIR1/Hausa-ASR, NCAIR1/NigerianAccentedEnglish (Pidgin and English); model ID logged on every voice note |
| Read-backs answered on voice notes | 11: **9 confirmed, 2 corrected (81.8% first-pass accuracy)** |
| First-pass accuracy, all money logs (voice + typed) | 84.6% |
| Extraction path | N-ATLaS 15 · N-ATLaS with the amount guard stepping in 11 · keyword commands 9 |
| Average speech-to-text time (transcribed notes) | about 1.1–1.2 s for 6–8 s notes |
| Ledger entries saved | 18 (all recorded with a field agent) |
| Owner confirmations | 2, made on the link **without** an owner PIN, so not counted as verified under the owner-PIN rule |

## Voice notes that did not reach a read-back

We report these openly rather than leave them out:

1. **12 voice notes (14:06–14:20)** arrived while the GPU server was being repaired (a CUDA driver/library mismatch on a newly provisioned pod). The server log shows `ASR 500` for that window. The fix is now pinned in `model-service/requirements-gpu.txt` and `setup.sh`.
2. **Most of the rest were sent during onboarding**, where RidePass needs a button tap (vehicle, ownership). The app silently repeated the question, so riders kept talking. Since commit `ed9b423` the app now tells riders, in their language, to tap a button.
3. Some transcripts were erased when riders used **DELETE MY DATA**; those interactions keep only anonymous counters.

## What this shows, and what it does not

- **Shown:** the full voice → N-ATLAS speech recognition → N-ATLaS extraction → read-back → confirmed ledger flow works in production in Pidgin, Hausa and English, with about 1 s speech recognition and over 80% of read-backs confirmed without correction. Consent, data deletion and the amount guard behaved as designed.
- **Not yet shown:** sustained daily logging (a credit passport needs 14 active days), owner-PIN confirmations, Yorùbá and Igbo voice notes, and lender decisions. These are the next stage of the pilot (see `PILOT_PROTOCOL.md`).

*Incentives:* if riders were paid airtime or other incentives for taking part, state it here.
