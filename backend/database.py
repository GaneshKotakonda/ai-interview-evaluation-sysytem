"""PostgreSQL connection helpers.

Connections use ``RealDictCursor`` so every row is a dict
(``row["role_title"]``) rather than a tuple (``row[1]``). Callers own the
connection: commit or roll back, then close it.
"""
import logging
import urllib.parse

import psycopg2
from psycopg2.extras import RealDictCursor

import config

logger = logging.getLogger(__name__)


# -------------------------------------------------------------
# BLOCK 1: Connection-string sanitising
# -------------------------------------------------------------
def get_safe_db_url(url: str) -> str:
    """Percent-encode an ``@`` inside the password of a postgres URL.

    ``postgresql://user:p@ss@host/db`` would otherwise be parsed with
    ``ss@host`` as the host name. Only the password is re-encoded; URLs with
    a single ``@`` are returned unchanged.
    """
    if not url:
        return url
    try:
        if url.count("@") > 1 and "://" in url:
            prefix, remainder = url.split("://", 1)
            last_at_index = remainder.rfind("@")
            credentials = remainder[:last_at_index]
            host_and_path = remainder[last_at_index + 1:]
            if ":" in credentials:
                user, pwd = credentials.split(":", 1)
                safe_pwd = urllib.parse.quote_plus(pwd)
                return f"{prefix}://{user}:{safe_pwd}@{host_and_path}"
    except Exception:
        # A malformed URL is passed through; psycopg2 reports the real error.
        pass
    return url


DATABASE_URL = get_safe_db_url(config.DATABASE_URL)


# -------------------------------------------------------------
# BLOCK 2: Open a connection
# -------------------------------------------------------------
def get_db_connection():
    """Open and return a new PostgreSQL connection with dict rows.

    Raises ``ValueError`` when DATABASE_URL is not configured.
    """
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is not set. Add it to backend/.env.")
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


# -------------------------------------------------------------
# BLOCK 3: Startup health check
# -------------------------------------------------------------
def test_db_connection() -> bool:
    """Log the PostgreSQL version; return False instead of raising on failure.

    Used at server startup so a missing database is reported clearly while
    the API process still starts (endpoints then fail with HTTP 500).
    """
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                logger.info("Connected to PostgreSQL: %s", cur.fetchone()["version"])
        finally:
            conn.close()
        return True
    except Exception as error:
        logger.error("Could not connect to PostgreSQL: %s", error)
        return False
