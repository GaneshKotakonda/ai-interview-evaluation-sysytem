"""Firebase ID-token verification and per-request authorization.

Tokens are signed with a locally generated RSA key whose certificate stands
in for Google's published certificates, so the real verification code runs
end to end without network access.
"""
import datetime
import time
import unittest
from unittest.mock import patch

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.auth import crypt, jwt

import auth
import config
import main
from test_main import FakeConnection
from test_profile import ScriptedCursor

PROJECT = config.FIREBASE_PROJECT_ID
KEY_ID = "test-key"
INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "11111111-1111-1111-1111-111111111111"


def _key_and_cert():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name)
        .public_key(key.public_key()).serial_number(1)
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    pem_key = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
    ).decode()
    return pem_key, cert.public_bytes(serialization.Encoding.PEM).decode()


PRIVATE_KEY, CERT = _key_and_cert()
OTHER_PRIVATE_KEY, _ = _key_and_cert()


def make_token(uid="firebase-user-abc123", private_key=PRIVATE_KEY, **overrides):
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{PROJECT}", "aud": PROJECT,
        "sub": uid, "iat": now, "exp": now + 3600, "email": "c@example.com",
    }
    claims.update(overrides)
    signer = crypt.RSASigner.from_string(private_key, key_id=KEY_ID)
    return jwt.encode(signer, claims).decode()


class VerifyIdTokenTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(auth, "public_certs", return_value={KEY_ID: CERT})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_valid_token_returns_user(self):
        user = auth.verify_id_token(make_token())
        self.assertEqual(user, auth.AuthUser(uid="firebase-user-abc123", email="c@example.com"))

    def test_rejects_invalid_tokens(self):
        now = int(time.time())
        cases = {
            "wrong signer": make_token(private_key=OTHER_PRIVATE_KEY),
            "expired": make_token(iat=now - 7200, exp=now - 3600),
            "other project audience": make_token(aud="another-project"),
            "wrong issuer": make_token(iss="https://evil.example.com"),
            "empty subject": make_token(uid=""),
            "garbage": "not-a-jwt",
        }
        for label, token in cases.items():
            with self.subTest(label), self.assertRaises(ValueError):
                auth.verify_id_token(token)


class HttpAuthTests(unittest.TestCase):
    """Requests through the real app: header parsing and status codes."""

    def setUp(self):
        patcher = patch.object(auth, "public_certs", return_value={KEY_ID: CERT})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(main.app)

    def test_endpoints_require_a_token(self):
        for method, path in [
            ("get", f"/api/interviews/{INTERVIEW_ID}/report"),
            ("delete", f"/api/interviews/{INTERVIEW_ID}"),
            ("get", "/api/users/firebase-user-abc123/profile"),
            ("post", "/api/interviews/start"),
        ]:
            with self.subTest(path=path):
                response = getattr(self.client, method)(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers.get("www-authenticate"), "Bearer")

    def test_invalid_token_is_rejected(self):
        bad = make_token(private_key=OTHER_PRIVATE_KEY)
        response = self.client.get(
            "/api/users/firebase-user-abc123/profile", headers={"Authorization": f"Bearer {bad}"})
        self.assertEqual(response.status_code, 401)

    def test_token_for_another_user_cannot_read_their_account(self):
        token = make_token(uid="attacker")
        response = self.client.get(
            "/api/users/firebase-user-abc123/reports", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 403)

    def test_certificate_outage_returns_503(self):
        import requests
        with patch.object(auth, "public_certs", side_effect=requests.ConnectionError()):
            response = self.client.get(
                "/api/users/firebase-user-abc123/profile",
                headers={"Authorization": f"Bearer {make_token()}"})
        self.assertEqual(response.status_code, 503)

    def test_health_stays_public(self):
        with patch.object(main.database, "test_db_connection", return_value=True):
            self.assertEqual(self.client.get("/api/health").status_code, 200)


@pytest.mark.real_auth
class OwnershipTests(unittest.TestCase):
    def _call(self, fn, owner_uid, *args):
        cursor = ScriptedCursor(one={
            "SELECT * FROM interviews": {"id": INTERVIEW_ID, "user_id": USER_ID, "status": "completed"},
            "SELECT firebase_uid FROM users": {"firebase_uid": owner_uid} if owner_uid else None,
        })
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            return fn(INTERVIEW_ID, *args, user=auth.AuthUser(uid="attacker"))

    def test_interview_endpoints_hide_other_users_interviews(self):
        endpoints = [
            (main.get_interview_report, ()),
            (main.arena_results, ()),
            (main.next_question, ()),
            (main.arena_hint, (main.HintRequest(current_turn=1),)),
            (main.complete_and_evaluate_interview, (main.EvaluateInterviewRequest(),)),
            (main.submit_answer, (1, "q", "answer", None)),
            (main.delete_interview, ()),
        ]
        for fn, args in endpoints:
            for owner in ("firebase-user-abc123", None):
                with self.subTest(fn=fn.__name__, owner=owner), self.assertRaises(HTTPException) as ctx:
                    self._call(fn, owner, *args)
                self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
