#!/usr/bin/env bash
# One-time install on a fresh GPU pod (RunPod PyTorch template). Run from model-service/:  ./setup.sh
# Then start the models with ./start.sh. Takes about 5 minutes.
set -euo pipefail

if ! command -v nvidia-smi >/dev/null || ! nvidia-smi >/dev/null 2>&1; then
  echo "ERROR: no NVIDIA GPU is attached to this pod. Deploy a GPU pod (A40 / A6000 / L40S) and try again." >&2
  exit 1
fi
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ "${FREE_GB:-0}" -lt 25 ]; then
  echo "ERROR: only ${FREE_GB} GB free on the container disk; at least 25 GB is needed (set Container Disk to 80 GB)." >&2
  exit 1
fi

apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null
pip install --no-cache-dir -r requirements-gpu.txt

# Leftovers from images or earlier installs built for CUDA 13 break the speech models on CUDA 12.8
# drivers (libnvrtc.so.13 / CUDNN_STATUS_NOT_INITIALIZED). Remove them if present.
pip uninstall -y torchcodec nvidia-cudnn-cu13 >/dev/null 2>&1 || true

python - <<'PY'
import torch
assert torch.cuda.is_available(), "PyTorch cannot see the GPU (driver/CUDA mismatch)"
x = torch.randn(1, 1, 16, device="cuda")
torch.nn.functional.conv1d(x, torch.randn(1, 1, 3, device="cuda"))  # exercises cuDNN, as the ASR models do
print(f"OK: torch {torch.__version__}, CUDA {torch.version.cuda}, cuDNN {torch.backends.cudnn.version()}, GPU {torch.cuda.get_device_name(0)}")
PY
echo "Setup complete. Now: export HF_TOKEN=... MODEL_SERVICE_TOKEN=... && ./start.sh"
