#!/usr/bin/env bash
# Starts both halves of the N-ATLAS stack on one GPU box (RunPod / Modal / own server):
#  - vLLM serving NCAIR1/N-ATLaS (OpenAI-compatible) on :8000   -> $LOG_DIR/vllm.log
#  - ASR FastAPI (NCAIR1 speech models) on :9000                  -> $LOG_DIR/asr.log
# Each server runs independently and restarts itself if it crashes, so one failing never takes
# the other down. Returns immediately; follow the logs with: tail -f $LOG_DIR/*.log
# If vLLM complains the model has no chat template: VLLM_CHAT_TEMPLATE=./llama3_chat_template.jinja
# Needs: HF_TOKEN (account that accepted the NCAIR1 model licences), MODEL_SERVICE_TOKEN.
set -euo pipefail
: "${HF_TOKEN:?set HF_TOKEN}"
: "${MODEL_SERVICE_TOKEN:?set MODEL_SERVICE_TOKEN}"
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
# vLLM reads its API key from VLLM_API_KEY; passing it this way keeps it out of the startup log
# (a --api-key flag is echoed in vLLM's "non-default args" line).
export VLLM_API_KEY="$MODEL_SERVICE_TOKEN"
cd "$(dirname "$0")"
LOG_DIR="${LOG_DIR:-/workspace}"
mkdir -p "$LOG_DIR"

# Some templates turn on fast downloads; fall back to normal downloads if the package is missing.
if [ "${HF_HUB_ENABLE_HF_TRANSFER:-0}" = "1" ] && ! python -c "import hf_transfer" 2>/dev/null; then
  export HF_HUB_ENABLE_HF_TRANSFER=0
fi

# Stop anything from a previous start so ports 8000/9000 are free.
pkill -f "ridepass-supervise" 2>/dev/null || true
pkill -f "vllm serve NCAIR1/N-ATLaS" 2>/dev/null || true
pkill -f "uvicorn app:app" 2>/dev/null || true
sleep 2

# GPU sizing (N-ATLaS = 8B params ≈ 16 GB in bf16; the 4 ASR models need ~3 GB):
#   48 GB card (A40 / L40S / A6000):  VLLM_GPU_UTIL=0.60                      (full bf16, recommended)
#   24 GB card (RTX 4090 / L4):       VLLM_GPU_UTIL=0.75 VLLM_QUANT=fp8        (fp8 weights ≈ 8.5 GB)
supervise() {  # supervise <name> <command...> : rerun the command whenever it exits
  local name=$1; shift
  ( exec -a "ridepass-supervise-$name" bash -c '
      while true; do
        echo "[$(date -u +%FT%TZ)] starting $0"; "$@"; rc=$?; echo "[$(date -u +%FT%TZ)] $0 exited ($rc); restarting in 10 s"; sleep 10
      done' "$name" "$@" ) >> "$LOG_DIR/$name.log" 2>&1 &
}

supervise vllm vllm serve NCAIR1/N-ATLaS \
  --served-model-name n-atlas \
  --dtype bfloat16 \
  --max-model-len 4096 \
  --gpu-memory-utilization "${VLLM_GPU_UTIL:-0.60}" \
  ${VLLM_QUANT:+--quantization "$VLLM_QUANT"} \
  ${VLLM_CHAT_TEMPLATE:+--chat-template "$VLLM_CHAT_TEMPLATE"} \
  --port 8000

supervise asr uvicorn app:app --host 0.0.0.0 --port 9000

echo "Started. Logs: $LOG_DIR/vllm.log and $LOG_DIR/asr.log  (ready in ~2 min; first start downloads ~17 GB)"
# In a container (Docker ENTRYPOINT) keep the main process alive; in a terminal this returns at once.
if [ "${KEEP_FOREGROUND:-0}" = "1" ]; then wait; fi
