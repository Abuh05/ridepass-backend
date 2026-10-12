# How the evaluation panel can test RidePass (about 10 minutes)

WhatsApp is pending Meta business verification, so judges use the web app and the field-agent app,
which run the same conversation engine and the same N-ATLAS models. The two judges' API keys are
provided privately in the submission form (one field-agent key, one lessor key).

**Before testing:** the N-ATLAS GPU must be running. Check https://credit-passport-tau.vercel.app/health
returns `"mode":"natlas"`. If a voice note answers "checking your voice note…" for more than a minute,
the GPU is starting; the note is queued and will be answered.

## 1. Register a test rider and log money by voice (field-agent app)
1. Open https://credit-passport-tau.vercel.app/agent and sign in with the **judges' field-agent key**.
2. Enter any test phone number (for example `08099990101`) and a 4-digit PIN, then **Open rider**.
3. Tap a language (try **Hausa** or **Pidgin**), tap **I agree**, type a first name, tap the vehicle and ownership buttons,
   enter an owner phone (or `0` to skip) and a daily amount, then answer the research question.
4. Hold the microphone and say, for example:
   - Hausa: *"Yau na samu dubu goma sha huɗu, mai dubu biyar, na biya mai keke dubu uku."*
   - Pidgin: *"I make 14 thousand today, fuel 5,200, I pay owner 3,000."*
5. RidePass reads the amounts back in the chosen language (NCAIR1 speech recognition + N-ATLaS). Tap **Correct**.
6. Optional: log in as that rider at https://credit-passport-tau.vercel.app/rider with the phone and PIN.
   Send **SUMMARY**, then **DELETE MY DATA** to see the erasure flow.

## 2. Lessor view
Open https://credit-passport-tau.vercel.app/dashboard with the **judges' lessor key**. Use "Ask a rider for access"
with your test rider's phone (Daily repayment tracking); approve it in the rider chat; the rider appears in the portfolio.

## 3. Integrity and transparency
- Verify any signed passport at https://credit-passport-tau.vercel.app/verify (public key: `/.well-known/ridepass-key.pem`).
- Daily ledger anchors (Merkle roots): https://credit-passport-tau.vercel.app/api/anchors
- Source code: https://github.com/Abuh05/ridepass-backend (43 automated tests: `cd app && npm test`).
- Privacy notice: https://credit-passport-tau.vercel.app/privacy
