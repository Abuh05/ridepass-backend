# Data protection: Nigeria Data Protection Act 2023 alignment

> This is an engineering summary, not legal advice. Have a data-protection professional review it before scaling. The NDPC may require registration as a data controller or processor of major importance.

| NDPA principle | How RidePass implements it |
|---|---|
| **Lawful basis: consent** | Explicit, versioned consent (`CONSENT_VERSION`) is captured in the rider's language before any profile or ledger data is stored. The answer, channel and timestamp are kept in `consents`. Declining stores nothing but a hashed phone number. |
| **Purpose limitation** | Data is used for record keeping and for the credit passport. Sharing needs a **separate, per-organisation** approval (grant), and passport grants expire after 30 days. Voice-note retention for AI research is a separate, optional consent. |
| **Data minimisation** | We collect first name, phone, vehicle type, ownership type and money entries. No NIN, BVN, address, photo or location. Audio is deleted after transcription unless the rider opted in to research, and retained clips carry no name or phone. |
| **Security** | Phone and name are encrypted with AES-256-GCM at rest, and phone lookup uses a keyed hash. API keys and PINs are stored as scrypt hashes. The WhatsApp webhook signature is verified. The ledger is hash-chained and passports are signed. HTTPS only. |
| **Transparency / right of access** | `MY DATA` returns a download with the profile, all entries, consents, sharing grants, and **who viewed the data and when** (`access_log`). |
| **Right to erasure** | `DELETE MY DATA` removes the profile, ledger, passports, grants and codes. Interaction rows keep only anonymous counters for aggregate metrics. |
| **Right to withdraw consent** | `STOP SHARING` revokes all lender and lessor access immediately. |
| **Automated decision-making** | The score is explainable, with components and plain-language reasons in every passport. It excludes protected characteristics. It is decision *support*: lenders are told to combine it with their own assessment. |
| **Third-party data (owners)** | The owner's number comes from the rider. The owner's first message explains the purpose, and the owner's reply is recorded as their consent to confirmations. |
| **Cross-border transfer** | Pick a hosting region and document it. For a pilot on RunPod or Railway, note the region in the privacy notice, and move to Nigerian or approved hosting when scaling. |
| **Retention** | Default: the ledger is kept while the account is active. Riders inactive for 12 months are deleted (implement as a scheduled job before the commercial launch). |

**N-ATLAS licence conditions honoured:** a 1,000 active end-user cap (built-in guard), no surveillance, no discriminatory profiling (the score is behaviour-only), and no disinformation.
