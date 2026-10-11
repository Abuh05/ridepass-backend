#!/usr/bin/env bash
# Starts both halves of the N-ATLAS stack on one GPU box (RunPod / Modal / own server).
#  - vLLM serving NCAIR1/N-ATLaS (OpenAI-compatible) on :8000
#  - ASR FastAPI on :9000
# If vLLM complains the model has no chat template: VLLM_CHAT_TEMPLATE=./llama3_chat_template.jinja
# Needs: HF_TOKEN (account that accepted the NCAIR1 model licences), MODEL_SERVICE_TOKEN.
set -euo pipefail
: "${HF_TOKEN:?set HF_TOKEN}"
: "${MODEL_SERVICE_TOKEN:?set MODEL_SERVICE_TOKEN}"
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"

# GPU sizing (N-ATLaS = 8B params ≈ 16 GB in bf16; the 4 ASR models need ~3 GB):
#   48 GB card (L40S / A6000):  VLLM_GPU_UTIL=0.60                      (full bf16, recommended)
#   24 GB card (RTX 4090 / L4): VLLM_GPU_UTIL=0.75 VLLM_QUANT=fp8        (fp8 weights ≈ 8.5 GB)
vllm serve NCAIR1/N-ATLaS \
  --served-model-name n-atlas \
  --dtype bfloat16 \
  --max-model-len 4096 \
  --gpu-memory-utilization "${VLLM_GPU_UTIL:-0.60}" \
  ${VLLM_QUANT:+--quantization "$VLLM_QUANT"} \
  ${VLLM_CHAT_TEMPLATE:+--chat-template "$VLLM_CHAT_TEMPLATE"} \
  --api-key "$MODEL_SERVICE_TOKEN" \
  --port 8000 &
VLLM_PID=$!

uvicorn app:app --host 0.0.0.0 --port 9000 &
ASR_PID=$!

trap 'kill $VLLM_PID $ASR_PID' EXIT
wait -n
