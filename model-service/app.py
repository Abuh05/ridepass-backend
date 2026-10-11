"""
RidePass model service — official N-ATLAS speech recognition (NCAIR1 ASR models).

Runs on the GPU box next to vLLM (which serves NCAIR1/N-ATLaS on an OpenAI-compatible API).
The Node app calls:
  POST /asr        multipart: file=<audio>, language=en|ha|yo|ig   -> transcript
  GET  /health     model status
All requests require `Authorization: Bearer $MODEL_SERVICE_TOKEN`.
"""
import os
import subprocess
import time
import threading

import numpy as np
import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from transformers import pipeline

ASR_MODELS = {
    "en": "NCAIR1/NigerianAccentedEnglish",
    "ha": "NCAIR1/Hausa-ASR",
    "yo": "NCAIR1/Yoruba-ASR",
    "ig": "NCAIR1/Igbo-ASR",
}
TOKEN = os.environ.get("MODEL_SERVICE_TOKEN", "")
MAX_SECONDS = int(os.environ.get("MAX_AUDIO_SECONDS", "150"))
PRELOAD = os.environ.get("PRELOAD_ASR", "all")  # "all" | "none" | "en,ha"
DEVICE = 0 if torch.cuda.is_available() else -1
DTYPE = torch.float16 if torch.cuda.is_available() else torch.float32

app = FastAPI(title="RidePass N-ATLAS model service")
_pipes: dict = {}
_lock = threading.Lock()


def get_pipe(lang: str):
    if lang not in ASR_MODELS:
        raise HTTPException(400, f"unsupported language '{lang}'")
    with _lock:
        if lang not in _pipes:
            _pipes[lang] = pipeline(
                "automatic-speech-recognition",
                model=ASR_MODELS[lang],
                device=DEVICE,
                torch_dtype=DTYPE,
                token=os.environ.get("HF_TOKEN"),
            )
        return _pipes[lang]


def decode_audio(data: bytes) -> np.ndarray:
    """Any container (WhatsApp OGG/Opus, browser WebM, MP3, WAV) -> 16 kHz mono float32 via ffmpeg."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode != 0:
        raise HTTPException(422, f"could not decode audio: {proc.stderr.decode()[:200]}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def check_auth(authorization: str | None):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")


@app.on_event("startup")
def preload():
    langs = [] if PRELOAD == "none" else (list(ASR_MODELS) if PRELOAD == "all" else PRELOAD.split(","))
    for lang in langs:
        get_pipe(lang.strip())


@app.get("/health")
def health():
    return {
        "ok": True,
        "cuda": torch.cuda.is_available(),
        "loaded": {k: ASR_MODELS[k] for k in _pipes},
        "models": ASR_MODELS,
    }


@app.post("/asr")
async def asr(
    file: UploadFile = File(...),
    language: str = Form("en"),
    authorization: str | None = Header(None),
):
    check_auth(authorization)
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(413, "audio too large")
    audio = decode_audio(raw)
    seconds = len(audio) / 16000
    if seconds < 0.3:
        raise HTTPException(422, "audio too short")
    if seconds > MAX_SECONDS:
        raise HTTPException(413, f"audio longer than {MAX_SECONDS}s")
    # Near-silent audio (muted or wrong microphone) makes Whisper models hallucinate text.
    # Thresholds are deliberately low so quiet speech still passes.
    if float(np.max(np.abs(audio))) < 0.02 or float(np.sqrt(np.mean(audio ** 2))) < 0.002:
        raise HTTPException(422, "no speech detected (audio is near-silent)")
    pipe = get_pipe(language)
    t0 = time.time()
    # NCAIR ASR models are Whisper-small fine-tunes with a 30 s window -> chunk long notes.
    out = pipe({"raw": audio, "sampling_rate": 16000}, chunk_length_s=30, stride_length_s=5, batch_size=4)
    return {
        "text": out["text"].strip(),
        "language": language,
        "model": ASR_MODELS[language],
        "audio_seconds": round(seconds, 2),
        "latency_ms": int((time.time() - t0) * 1000),
    }
