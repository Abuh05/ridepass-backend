# Deploying RidePass

There are two parts: the **model service**, which runs on a rented GPU, and the **app**, which runs on any small server. Budget about 2 hours for the first setup.

## 0. Accounts and access (do these today, because some take time)

| What | Why | Where |
|---|---|---|
| Hugging Face account + token | Download N-ATLAS models | huggingface.co → Settings → Access Tokens (read) |
| **Accept the licence on all 5 NCAIR1 models** | They are gated; downloads fail otherwise | `NCAIR1/N-ATLaS`, `NCAIR1/Hausa-ASR`, `NCAIR1/Yoruba-ASR`, `NCAIR1/Igbo-ASR`, `NCAIR1/NigerianAccentedEnglish` |
| Meta Business account + WhatsApp Cloud API app | Rider channel | developers.facebook.com → Create app → WhatsApp. **Business verification can take days. Start now.** The test number works immediately for up to 5 registered testers. |
| GPU cloud (RunPod recommended) | Runs N-ATLAS | runpod.io |
| App host (Railway, which you already use, or any VPS) | Runs the Node app | railway.app |

## 1. Model service on RunPod

1. Deploy a GPU pod:
   - **L40S or RTX A6000 (48 GB)** is recommended.
   - An **RTX 4090 (24 GB)** also works, but needs `VLLM_QUANT=fp8`.
   - Template: *RunPod PyTorch 2.x*. Container disk 60 GB. Expose HTTP ports **8000, 9000**.
2. Open the pod's terminal and run:
   ```bash
   git clone <your repo> ridepass && cd ridepass/model-service
   apt-get update && apt-get install -y ffmpeg
   pip install "vllm>=0.6.6" -r requirements.txt
   export HF_TOKEN=hf_xxx MODEL_SERVICE_TOKEN=<from npm run keys>
   # 48 GB card:
   ./start.sh
   # 24 GB card:
   VLLM_GPU_UTIL=0.75 VLLM_QUANT=fp8 ./start.sh
   ```
   The first start downloads about 17 GB of weights, which takes 5–10 minutes.
3. Your URLs are `https://<POD_ID>-8000.proxy.runpod.net/v1` (N-ATLaS) and `https://<POD_ID>-9000.proxy.runpod.net` (ASR).
4. Check that it works:
   ```bash
   curl https://<POD_ID>-9000.proxy.runpod.net/health
   curl -H "Authorization: Bearer $MODEL_SERVICE_TOKEN" https://<POD_ID>-8000.proxy.runpod.net/v1/models
   ```
5. If vLLM says the model has no chat template, add `VLLM_CHAT_TEMPLATE=./llama3_chat_template.jinja`.

**Cost control:** stop the pod when it isn't needed. Riders' voice notes wait in the app's job queue and are processed when the GPU comes back. Riders see "checking your voice note…" in the meantime. During the pilot, keep the pod up from about 17:00 to 23:00 WAT, when riders log.

Docker alternative (own GPU server): run `docker compose up -d` from the repo root.

## 2. App

1. Run `cd app && npm run keys` and paste the output into `.env`, starting from `.env.example`.
   - **Back up `DATA_KEY`.** Without it, encrypted names and phone numbers cannot be recovered.
2. Set `MODEL_MODE=natlas`, `ASR_URL`, `LLM_BASE_URL`, `MODEL_SERVICE_TOKEN`, `PUBLIC_BASE_URL` (HTTPS) and `NODE_ENV=production`.
3. Deploy on **Railway**:
   - New project → Deploy from repo → set the root directory to `app/` (it uses the Dockerfile).
   - Add a **Volume mounted at `/app/data`**. The SQLite database lives there; without a volume it is wiped on every deploy.
   - Add the variables from `.env`.
4. Check that `https://<app>/health` returns `{"ok":true,"mode":"natlas"}`.
5. Check the model connection:
   ```bash
   curl -H "x-admin-key: $ADMIN_API_KEY" https://<app>/api/admin/model-health
   ```
   Both `asr` and `llm` should be `true`.
6. **Optional: web pages on Vercel.** Push `app/public` to its own repo and import it on Vercel (Framework preset: Other, no build command). `app/public/vercel.json` forwards `/api`, `/webhook` and `/.well-known` to the Railway URL; change that URL if yours differs. Then set `PUBLIC_BASE_URL` on Railway to the Vercel address so owner and share links open there.
7. **Remove test traffic before the pilot or a submission:** in the Railway service shell, run `npm run reset:activity -- --yes`. It writes a backup to `/app/data/backups/`, then clears riders, owners and their records, and keeps the organisations and their keys.

## 3. WhatsApp

1. In Meta → WhatsApp → Configuration → Webhook, set:
   - Callback URL: `https://<app>/webhook/whatsapp`
   - Verify token: your `WA_VERIFY_TOKEN`
2. Subscribe to the **messages** field.
3. Set `WA_ACCESS_TOKEN` (use a permanent System User token), `WA_PHONE_NUMBER_ID` and `WA_APP_SECRET`.
4. Submit the templates in `docs/WHATSAPP_TEMPLATES.md`. As each one is approved, add its name to `WA_TEMPLATES_APPROVED`.
5. Send "hi" to the number. You should get the language menu.

## 4. Organisations

Create one API key per organisation. The easy way is the **admin console** at `/admin`: sign in with `ADMIN_API_KEY`, then use “Onboard an organisation”. Or with curl:

```bash
curl -X POST https://<app>/api/admin/orgs -H "x-admin-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"name":"Phoenix Field Team","kind":"agent"}'
# kinds: agent (field staff) · lessor (keke/okada leasing firms, fleet owners) · lender (MFBs, fintechs)
```

Each key is shown once. Lessors and lenders use `/dashboard`. Agents use `/agent`. The step-by-step onboarding for every role is at `/guide`.

**Verify owners with a PIN.** Agents verify independent owners in person (“Verify an owner in person”), and lessors register their collection phone; both set a PIN the owner chooses. Only confirmations made with that PIN, or from the owner's own WhatsApp number, count as owner-confirmed.

## 5. Daily operations

| Task | How |
|---|---|
| Metrics | `GET /api/admin/metrics` |
| Evidence pack | `npm run export:interactions` writes `evidence/interactions.csv` and `metrics.json` |
| ASR accuracy (WER) | Label the clips in `data/benchmark/<lang>/pending_labels.csv`, then run `python model-service/benchmark/wer.py --url <ASR_URL> --data app/data/benchmark` |
| Extraction accuracy | Add real, labelled transcripts to `app/bench/nlu_cases.jsonl`, then `npm run bench:nlu` with the GPU up |
| Backups | Copy `/app/data/ridepass.db` daily |
