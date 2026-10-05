"""Central runtime configuration for the backend.

Every module reads settings from here instead of calling ``load_dotenv``
itself. Environment variables are loaded once, at import time, from
``backend/.env`` first and then from a ``.env`` in the working directory.
Real environment variables always win over values in either file.
"""
import os

from dotenv import load_dotenv

# -------------------------------------------------------------
# BLOCK 1: Load .env files once
# -------------------------------------------------------------
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))
load_dotenv()


# -------------------------------------------------------------
# BLOCK 2: Small typed readers
# -------------------------------------------------------------
def _env_str(name: str, default: str = "") -> str:
    """Return a stripped string setting, or ``default`` when unset/blank."""
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def _env_int(name: str, default: int) -> int:
    """Return an integer setting, falling back to ``default`` on bad input."""
    try:
        return int(_env_str(name, str(default)))
    except ValueError:
        return default


def _env_list(name: str, default: list[str]) -> list[str]:
    """Return a comma-separated setting as a list of non-empty items."""
    raw = _env_str(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


# -------------------------------------------------------------
# BLOCK 3: Settings used across the backend
# -------------------------------------------------------------
# PostgreSQL connection string, e.g. postgresql://user:pass@host:5432/db
DATABASE_URL = _env_str("DATABASE_URL")

# Google Gemini credentials and model choices.
GEMINI_API_KEY = _env_str("GEMINI_API_KEY")
GEMINI_QUESTION_MODEL = _env_str("GEMINI_QUESTION_MODEL", "gemini-flash-lite-latest")
GEMINI_EVALUATION_MODEL = _env_str("GEMINI_EVALUATION_MODEL", "gemini-flash-lite-latest")
GEMINI_EMBEDDING_MODEL = _env_str("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
# Every embedding is requested at this size so rubric and answer vectors
# always have equal length (cosine similarity is 0 for mismatched lengths).
EMBEDDING_DIMENSIONS = _env_int("EMBEDDING_DIMENSIONS", 768)
# Upper bound for a single Gemini HTTP call. Interview rows stay locked
# while Gemini runs, so a hung request must not hold the lock forever.
GEMINI_TIMEOUT_SECONDS = _env_int("GEMINI_TIMEOUT_SECONDS", 60)

# Browser origins allowed to call the API. Defaults cover the Vite dev
# server; set CORS_ORIGINS=https://your-site.example in production.
CORS_ORIGINS = _env_list(
    "CORS_ORIGINS",
    ["http://localhost:5173", "http://127.0.0.1:5173"],
)

# Firebase project whose ID tokens the API accepts (the frontend's
# VITE_FIREBASE_PROJECT_ID). Requests must carry a token from this project.
FIREBASE_PROJECT_ID = _env_str("FIREBASE_PROJECT_ID", "ai-evaluation-40c8a")

# Speech-to-text (stt_service.py). faster-whisper runs locally and is open
# source (MIT). STT_PROVIDER: "whisper" (default), "gemini" (send audio to
# Gemini) or "off". Whisper falls back to Gemini when a key is configured.
STT_PROVIDER = _env_str("STT_PROVIDER", "whisper").lower()
# Model size: tiny.en, base.en (default), small.en, medium.en, large-v3 ...
STT_MODEL = _env_str("STT_MODEL", "base.en")
STT_DEVICE = _env_str("STT_DEVICE", "cpu")
# int8 keeps CPU memory and latency low; use float16 on a GPU.
STT_COMPUTE_TYPE = _env_str("STT_COMPUTE_TYPE", "int8")
STT_LANGUAGE = _env_str("STT_LANGUAGE", "en")
# Answers longer than this are rejected before transcription.
STT_MAX_AUDIO_SECONDS = _env_int("STT_MAX_AUDIO_SECONDS", 600)

# Text-to-speech (tts_service.py): Piper, an open-source neural voice that
# runs locally. TTS_PROVIDER: "piper" (default) or "off" (the browser then
# falls back to its own speech synthesis).
TTS_PROVIDER = _env_str("TTS_PROVIDER", "piper").lower()
PIPER_VOICE = _env_str("PIPER_VOICE", "en_US-lessac-medium")
PIPER_VOICE_DIR = _env_str("PIPER_VOICE_DIR", os.path.join(BACKEND_DIR, "voices"))
# >1 speaks more slowly; interview questions read slightly slower than default.
PIPER_LENGTH_SCALE = float(_env_str("PIPER_LENGTH_SCALE", "1.05"))
TTS_CACHE_DIR = _env_str("TTS_CACHE_DIR", os.path.join(BACKEND_DIR, "tts_cache"))

# Proctoring: leaving the interview (fullscreen exit, tab switch, another
# window or app) this many times ends the interview automatically.
PROCTORING_MAX_VIOLATIONS = _env_int("PROCTORING_MAX_VIOLATIONS", 5)

# Whole-interview recording, uploaded in chunks while the interview runs.
MAX_SESSION_RECORDING_MB = _env_int("MAX_SESSION_RECORDING_MB", 800)

# Largest answer video accepted by /submit-answer, in megabytes.
MAX_UPLOAD_MB = _env_int("MAX_UPLOAD_MB", 200)

# Port used when running ``python main.py`` directly.
PORT = _env_int("PORT", 8000)
