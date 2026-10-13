"""Firebase ID-token verification for API requests.

The browser signs in with Firebase and sends ``Authorization: Bearer <ID
token>`` on every call. The token is a JWT signed by Google; verifying it
needs only the Firebase project ID and Google's public signing certificates,
so no service-account key is required.

Checks (as documented for Firebase ID tokens): RS256 signature by one of
Google's current certificates, ``aud`` = project ID, ``iss`` =
``https://securetoken.google.com/<project ID>``, unexpired, and a non-empty
``sub`` (the Firebase UID).
"""
import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Optional

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth import exceptions as google_auth_exceptions
from google.auth import jwt

import config

logger = logging.getLogger(__name__)

CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
DEFAULT_CERT_TTL_SECONDS = 3600
CLOCK_SKEW_SECONDS = 10


@dataclass(frozen=True)
class AuthUser:
    """The verified identity behind a request."""
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None


# -------------------------------------------------------------
# BLOCK 1: Google's public certificates (cached per Cache-Control)
# -------------------------------------------------------------
_cert_cache = {"certs": None, "expires_at": 0.0}
_cert_lock = threading.Lock()


def _max_age(cache_control: str) -> int:
    match = re.search(r"max-age=(\d+)", cache_control or "")
    return int(match.group(1)) if match else DEFAULT_CERT_TTL_SECONDS


def public_certs() -> dict:
    """Return ``{key id: PEM certificate}``, refreshing when the cache expires."""
    with _cert_lock:
        if _cert_cache["certs"] and time.time() < _cert_cache["expires_at"]:
            return _cert_cache["certs"]
        response = requests.get(CERTS_URL, timeout=10)
        response.raise_for_status()
        _cert_cache["certs"] = response.json()
        _cert_cache["expires_at"] = time.time() + _max_age(response.headers.get("Cache-Control"))
        return _cert_cache["certs"]


# -------------------------------------------------------------
# BLOCK 2: Token verification
# -------------------------------------------------------------
def verify_id_token(token: str) -> AuthUser:
    """Verify a Firebase ID token and return its user; ``ValueError`` if invalid."""
    project_id = config.FIREBASE_PROJECT_ID
    try:
        claims = jwt.decode(
            token, certs=public_certs(), audience=project_id,
            clock_skew_in_seconds=CLOCK_SKEW_SECONDS,
        )
    except (ValueError, google_auth_exceptions.GoogleAuthError) as error:
        raise ValueError(f"Invalid ID token: {error}") from error
    if claims.get("iss") != f"https://securetoken.google.com/{project_id}":
        raise ValueError("Invalid ID token issuer.")
    uid = claims.get("sub")
    if not isinstance(uid, str) or not uid or len(uid) > 128:
        raise ValueError("Invalid ID token subject.")
    return AuthUser(uid=uid, email=claims.get("email"), name=claims.get("name"))


# -------------------------------------------------------------
# BLOCK 3: FastAPI dependency
# -------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)


def current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> AuthUser:
    """Require a valid Firebase ID token; 401 when missing or invalid."""
    unauthorized = HTTPException(
        status_code=401, detail="Sign in again to continue.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or not credentials.credentials:
        raise unauthorized
    try:
        return verify_id_token(credentials.credentials)
    except requests.RequestException:
        logger.exception("Could not fetch Firebase signing certificates")
        raise HTTPException(status_code=503, detail="Sign-in verification is temporarily unavailable.")
    except ValueError as error:
        logger.info("Rejected request: %s", error)
        raise unauthorized


def require_self(firebase_uid: str, user: AuthUser) -> None:
    """403 unless a ``/users/{firebase_uid}`` path names the signed-in user."""
    if firebase_uid != user.uid:
        raise HTTPException(status_code=403, detail="You can only access your own account.")
