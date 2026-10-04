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

# Largest answer video accepted by /submit-answer, in megabytes.
MAX_UPLOAD_MB = _env_int("MAX_UPLOAD_MB", 200)

# Port used when running ``python main.py`` directly.
PORT = _env_int("PORT", 8000)
