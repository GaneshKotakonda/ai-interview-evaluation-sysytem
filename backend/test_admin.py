# The usage overview is for exactly one owner (ADMIN_UID + ADMIN_EMAIL).
import unittest
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient

import admin
import auth
import main
from auth import AuthUser

OWNER = AuthUser(uid="owner-uid", email="Owner@Example.com", name="Owner")


class OwnerOnlyTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.multiple("config", ADMIN_UID="owner-uid", ADMIN_EMAIL="owner@example.com")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_only_the_owner_matches(self):
        self.assertTrue(admin.is_owner(OWNER))
        self.assertFalse(admin.is_owner(AuthUser(uid="someone-else", email="owner@example.com")))  # same email, other account
        self.assertFalse(admin.is_owner(AuthUser(uid="owner-uid", email="other@example.com")))
        self.assertFalse(admin.is_owner(AuthUser(uid="owner-uid", email=None)))
        self.assertFalse(admin.is_owner(None))

    def test_nobody_has_access_when_not_configured(self):
        for uid, email in (("", "owner@example.com"), ("owner-uid", ""), ("", "")):
            with mock.patch.multiple("config", ADMIN_UID=uid, ADMIN_EMAIL=email):
                self.assertFalse(admin.is_owner(OWNER))

    def test_everyone_else_gets_not_found(self):
        with self.assertRaises(HTTPException) as caught:
            admin.require_owner(AuthUser(uid="intruder", email="intruder@example.com"))
        self.assertEqual(caught.exception.status_code, 404)

    def test_endpoints(self):
        client = TestClient(main.app)
        try:
            main.app.dependency_overrides[auth.current_user] = lambda: AuthUser(uid="intruder", email="owner@example.com")
            self.assertEqual(client.get("/api/admin/access").json(), {"owner": False})
            self.assertEqual(client.get("/api/admin/overview").status_code, 404)
            main.app.dependency_overrides[auth.current_user] = lambda: OWNER
            self.assertEqual(client.get("/api/admin/access").json(), {"owner": True})
            with mock.patch.object(admin, "overview", return_value={"summary": {}, "users": [], "sessions": [], "daily": []}), \
                 mock.patch.object(main, "transaction") as transaction:
                transaction.return_value.__enter__.return_value = (None, None)
                self.assertEqual(client.get("/api/admin/overview").status_code, 200)
        finally:
            main.app.dependency_overrides.clear()
        # Without a token there is nothing at all.
        self.assertEqual(TestClient(main.app).get("/api/admin/overview").status_code, 401)


if __name__ == "__main__":
    unittest.main()
