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


def _env_bool(name: str, default: bool) -> bool:
    value = _env_str(name).lower()
    if value in {"true", "1", "on", "yes"}:
        return True
    if value in {"false", "0", "off", "no"}:
        return False
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
# Interviewer voices: female/male in an American or British accent (see tts_service.voice_model).
PIPER_VOICE = _env_str("PIPER_VOICE", "en_US-lessac-medium")            # female (default)
PIPER_VOICE_MALE = _env_str("PIPER_VOICE_MALE", "en_US-ryan-medium")
# British accent (same female/male choice).
PIPER_VOICE_BRITISH = _env_str("PIPER_VOICE_BRITISH", "en_GB-jenny_dioco-medium")
PIPER_VOICE_BRITISH_MALE = _env_str("PIPER_VOICE_BRITISH_MALE", "en_GB-alan-medium")
PIPER_VOICE_DIR = _env_str("PIPER_VOICE_DIR", os.path.join(BACKEND_DIR, "voices"))
# >1 speaks more slowly; interview questions read slightly slower than default.
PIPER_LENGTH_SCALE = float(_env_str("PIPER_LENGTH_SCALE", "1.05"))
TTS_CACHE_DIR = _env_str("TTS_CACHE_DIR", os.path.join(BACKEND_DIR, "tts_cache"))

# Proctoring: leaving the interview (fullscreen exit, tab switch, another
# window or app) this many times ends the interview automatically.
PROCTORING_MAX_VIOLATIONS = _env_int("PROCTORING_MAX_VIOLATIONS", 3)
# Staying outside the interview (another tab, window or app) this many
# seconds in one go ends the interview at once.
PROCTORING_MAX_AWAY_SECONDS = _env_int("PROCTORING_MAX_AWAY_SECONDS", 5)

# Knowledge verification replaces a scheduled Standard turn. The policy
# never lowers the multi-family threshold below 60 or permits over two probes.
COUNTER_CHEATING_ENABLED = _env_bool("COUNTER_CHEATING_ENABLED", True)
COUNTER_CHEATING_THRESHOLD = max(60, min(100, _env_int("COUNTER_CHEATING_THRESHOLD", 60)))
COUNTER_CHEATING_MAX_CHALLENGES = max(0, min(2, _env_int("COUNTER_CHEATING_MAX_CHALLENGES", 2)))

# Coding round (VPL). Code runs in code_runner.py: in this process for local
# testing, or in the separate locked-down runner container when
# CODE_RUNNER_URL is set (see deploy/docker-compose.yml).
CODE_RUNNER_URL = _env_str("CODE_RUNNER_URL")
RUNNER_TOKEN = _env_str("RUNNER_TOKEN")
CODE_TIME_LIMIT_SECONDS = float(_env_str("CODE_TIME_LIMIT_SECONDS", "2"))
# Set only inside the dedicated runner container (deploy/Dockerfile.runner):
# one program at a time, every leftover process of the runner user killed
# and /tmp emptied after each run (code_runner.py). Never on a developer
# machine, where the sweep would hit the developer's own processes.
RUNNER_ISOLATE = _env_bool("RUNNER_ISOLATE", False)

# The one owner who may open the usage overview (admin.py). Set both in the
# server's private .env only; if either is empty, nobody has access.
ADMIN_UID = _env_str("ADMIN_UID")
ADMIN_EMAIL = _env_str("ADMIN_EMAIL")
CODING_MINUTES_PER_PROBLEM = _env_int("CODING_MINUTES_PER_PROBLEM", 20)

# Identity verification (identity.py): the enrolled voice and face are
# compared with every spoken answer and with face snapshots. "on" | "off".
# Models are downloaded by backend/download_models.py into IDENTITY_MODEL_DIR.
IDENTITY_CHECKS = _env_str("IDENTITY_CHECKS", "on").lower()
IDENTITY_MODEL_DIR = _env_str("IDENTITY_MODEL_DIR", os.path.join(BACKEND_DIR, "models"))
SPEAKER_MODEL = _env_str("SPEAKER_MODEL", "nemo_en_titanet_small.onnx")
FACE_DETECTOR_MODEL = _env_str("FACE_DETECTOR_MODEL", "face_detection_yunet_2023mar.onnx")
FACE_RECOGNIZER_MODEL = _env_str("FACE_RECOGNIZER_MODEL", "face_recognition_sface_2021dec.onnx")

# Whole-interview recording, uploaded in chunks while the interview runs.
MAX_SESSION_RECORDING_MB = _env_int("MAX_SESSION_RECORDING_MB", 800)

# Largest answer video accepted by /submit-answer, in megabytes.
MAX_UPLOAD_MB = _env_int("MAX_UPLOAD_MB", 200)

# Port used when running ``python main.py`` directly.
PORT = _env_int("PORT", 8000)
