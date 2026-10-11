# Pilot protocol: real-world validation, 1–11 October

**NAIC minimum:** 50 documented real-user interactions that go through the official N-ATLAS speech recognition.
**Our target:** 30 riders, 5 owners or lessors, and at least 300 voice interactions across at least 3 languages. Beating the minimum by a wide margin is what makes the "Real-World Validation" criterion stand out.

## Who

| Group | Number | Source |
|---|---|---|
| Keke/okada riders | 30 (about 10 Hausa, 8 Yorùbá, 6 Igbo, 6 English/Pidgin) | 2–3 parks. Ask the park chairman or the NATOMORAS branch first |
| Owners / lessors | 3–5 | The owners of those riders, plus one small leasing firm if possible |
| Field agents | 2–3 Phoenix staff | Help riders without WhatsApp; read the consent aloud |
| Lender observer | 1 | A microfinance bank or fintech that looks at 3–5 passports and gives written feedback |

## Day plan

| Day | Activity |
|---|---|
| 1–2 Oct | Park visits. Explain in the riders' language, **read the consent**, and onboard on WhatsApp or through an agent. Riders who hire-purchase or rent give their owner's number. Register lessor collection phones as verified owners. |
| 2–10 Oct | Riders send an evening voice note every day; the app reminds them at 19:00. Agents visit parks every 2 days to help and collect feedback. |
| 5 Oct | Mid-pilot check: correction rate by language. If Yorùbá corrections are above 30%, record more examples and adjust the prompts. |
| 6–9 Oct | Label 20 clips per language from riders who opted in to keep their voice notes. Run the WER benchmark. Run `npm run bench:nlu` on real transcripts. |
| 9–10 Oct | Lender observer reviews passports for riders with the most history, and the lessor dashboard walkthrough happens. Collect 2–3 short testimonial videos, with consent. |
| 11 Oct | Export evidence: `npm run export:interactions`. Freeze the numbers for the submission. |

Passports need 14 active days, so a scored passport won't exist from pilot data before the deadline. Show the building progress ("9/14 days") from real riders. Use `npm run simulate` data to demonstrate a scored passport in the video, and **label it clearly as synthetic**.

## Consent script (read aloud in the rider's language)

> "RidePass will write down the money you tell it you made and spent, so you can build a record that leasing companies and lenders can trust. Nobody sees your records unless you say yes to that specific company. You can see your data or delete everything at any time by sending MY DATA or DELETE MY DATA. If you agree, we can also keep your voice notes to improve Nigerian-language AI; that part is optional. Do you agree?"

The rider taps the answer themselves. Agents must never answer for them.

## What gets measured (automatically)

- Interactions, voice notes, and riders by language (`/api/admin/metrics`)
- **First-pass accuracy:** the share of voice logs the rider accepted as correct without re-recording. This is the headline real-world metric.
- Speech and N-ATLaS latency per language
- Model path share (`natlas`, `natlas_guarded`, `fallback`): proves the N-ATLAS integration and shows how often the guard-rails fired
- Owner confirmation rate and dispute rate
- Rider satisfaction (1–5), asked after the 5th log
- WER per language (benchmark script) and exact-match extraction accuracy (`bench:nlu`)
- EV-conversion leads

## Incentive (keep it modest and honest)

A ₦500 airtime top-up after 5 days of logging, and ₦1,000 after 10. Record this in the submission. Judges respect transparency about incentives.
