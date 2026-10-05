# Backend image: FastAPI + faster-whisper (CPU).
# Build from the repository root:  docker build -f deploy/Dockerfile -t interview-api .

# Python 3.12: every dependency (ctranslate2, PyAV, onnxruntime) ships
# prebuilt wheels for it, so no compiler or system ffmpeg is needed.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# Download the speech-to-text model at build time so the first request
# does not wait for it and the container needs no internet for STT.
ARG STT_MODEL=base.en
ENV STT_MODEL=${STT_MODEL}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${STT_MODEL}', device='cpu', compute_type='int8')"

# Same for the Piper voice used to speak the questions.
ARG PIPER_VOICE=en_US-lessac-medium
ENV PIPER_VOICE=${PIPER_VOICE} \
    PIPER_VOICE_DIR=/models/piper \
    TTS_CACHE_DIR=/app/backend/tts_cache
RUN python -m piper.download_voices "${PIPER_VOICE}" --download-dir /models/piper

COPY backend/ ./backend/
COPY schema.sql ./schema.sql

RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/backend/uploads /app/backend/tts_cache \
    && chown -R app:app /app /models
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

# One worker: each worker would load its own copy of the Whisper model.
CMD ["python", "-m", "uvicorn", "main:app", "--app-dir", "backend", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
