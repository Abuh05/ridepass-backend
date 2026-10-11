# WhatsApp message templates to submit

WhatsApp only lets a business start a conversation, or write more than 24 hours after the user's last message, with **pre-approved templates**. Submit these in Meta Business Manager → WhatsApp Manager → Message templates, under the **Utility** category. Submit an English version first; add `ha` (Hausa) where Meta supports it.

When a template is approved, add its name to `WA_TEMPLATES_APPROVED` in `.env` (comma-separated). Until then RidePass falls back safely:

- owner confirmations go out as a signed web link that the rider forwards;
- lender requests wait until the rider next messages;
- reminders are skipped.

### 1. `ridepass_payment_confirm`: owner confirms a payment

Body:
```
Hello. {{1}} says they paid you {{2}} on {{3}} for the vehicle. Is this correct? RidePass keeps a record of your answer to help riders build a trusted repayment history.
```
Buttons (Quick reply): `Yes, correct` · `Not correct`
Example values: Musa · ₦3,000 · 2026-10-02

### 2. `ridepass_daily_reminder`: evening reminder

Body:
```
Good evening {{1}}. Send today's RidePass voice note: how much you made, fuel, and owner payment. Reply STOP to stop reminders.
```

### 3. `ridepass_access_request`: a lender or lessor asks for access

Body:
```
{{1}} wants to see your RidePass records. Do you allow this? You can stop sharing at any time by sending STOP SHARING.
```
Buttons (Quick reply): `Allow` · `Refuse`
