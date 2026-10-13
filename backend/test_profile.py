import os
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException

BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest

import main
from auth import AuthUser
from test_main import FakeConnection


USER_ID = "11111111-1111-1111-1111-111111111111"
INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"
FIREBASE_UID = "firebase-user-abc123"
STATS = {
    "total_interviews": 3, "completed_interviews": 2, "standard_interviews": 2,
    "arena_sessions": 1, "average_score": 85, "best_score": 90,
    "total_practice_seconds": 780, "last_interview_at": "2026-09-27T10:00:00Z",
}


class ScriptedCursor:
    """Returns canned rows keyed by a substring of the last query."""

    def __init__(self, one=None, many=None):
        self.one = one or {}
        self.many = many or {}
        self.calls = []
        self.last_query = ""

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, query, params=None):
        self.last_query = " ".join(query.split())
        self.calls.append((self.last_query, params))

    def _match(self, table):
        for key, value in table.items():
            if key in self.last_query:
                return value
        return None

    def fetchone(self):
        return self._match(self.one)

    def fetchall(self):
        return self._match(self.many) or []


def run(cursor, fn, *args, uid=FIREBASE_UID):
    connection = FakeConnection(cursor)
    with patch.object(main.database, "get_db_connection", return_value=connection):
        return fn(*args, user=AuthUser(uid=uid)), connection


class ProfileTests(unittest.TestCase):
    def test_profile_for_unknown_user_returns_empty_stats(self):
        result, _ = run(ScriptedCursor(), main.get_profile, "unknown", uid="unknown")
        self.assertFalse(result["exists"])
        self.assertEqual(result["stats"]["total_interviews"], 0)
        self.assertIsNone(result["stats"]["average_score"])

    def test_profile_includes_aggregated_stats(self):
        cursor = ScriptedCursor(one={
            "FROM users WHERE firebase_uid": {
                "id": USER_ID, "email": "c@example.com", "full_name": "Candidate",
                "created_at": "2026-09-01T00:00:00Z",
            },
            "COUNT(*) AS total_interviews": STATS,
        })
        result, _ = run(cursor, main.get_profile, FIREBASE_UID)
        self.assertTrue(result["exists"])
        self.assertEqual(result["full_name"], "Candidate")
        self.assertEqual(result["stats"], STATS)
        stats_query = next(c for c in cursor.calls if "total_interviews" in c[0])
        self.assertEqual(stats_query[1], (USER_ID,))

    def test_update_profile_upserts_cleaned_values(self):
        cursor = ScriptedCursor(one={
            "INSERT INTO users": {
                "id": USER_ID, "email": "c@example.com", "full_name": "New Name",
                "created_at": "2026-09-01T00:00:00Z",
            },
            "COUNT(*) AS total_interviews": STATS,
        })
        payload = main.ProfileUpdateRequest(full_name="  New Name  ", email="   ")
        result, connection = run(cursor, main.update_profile, FIREBASE_UID, payload)
        upsert = next(c for c in cursor.calls if "INSERT INTO users" in c[0])
        self.assertEqual(upsert[1], (FIREBASE_UID, None, "New Name"))
        self.assertEqual(result["full_name"], "New Name")
        self.assertTrue(connection.committed)


class ReportsTests(unittest.TestCase):
    def test_reports_empty_for_unknown_user(self):
        cursor = ScriptedCursor()
        result, _ = run(cursor, main.get_user_reports, "unknown", uid="unknown")
        self.assertEqual(result, [])
        self.assertFalse(any("evaluation_reports" in q for q, _ in cursor.calls))

    def test_reports_are_scoped_to_user(self):
        rows = [{"interview_id": INTERVIEW_ID, "overall_score": 80}]
        cursor = ScriptedCursor(
            one={"SELECT id FROM users": {"id": USER_ID}},
            many={"FROM evaluation_reports": rows},
        )
        result, _ = run(cursor, main.get_user_reports, FIREBASE_UID)
        self.assertEqual(result, rows)
        query = next(c for c in cursor.calls if "FROM evaluation_reports" in c[0])
        self.assertEqual(query[1], (USER_ID,))


class SelfAccessTests(unittest.TestCase):
    def test_user_paths_reject_another_users_uid(self):
        for fn, args in [
            (main.get_profile, ()),
            (main.get_user_reports, ()),
            (main.get_user_interviews, ()),
            (main.update_profile, (main.ProfileUpdateRequest(full_name="X"),)),
        ]:
            cursor = ScriptedCursor()
            with self.subTest(fn=fn.__name__), self.assertRaises(HTTPException) as ctx:
                run(cursor, fn, "someone-else", *args)
            self.assertEqual(ctx.exception.status_code, 403)
            self.assertEqual(cursor.calls, [])


@pytest.mark.real_auth
class DeleteInterviewTests(unittest.TestCase):
    def _cursor(self, owner_uid):
        return ScriptedCursor(one={
            "SELECT * FROM interviews": {"id": INTERVIEW_ID, "user_id": USER_ID, "status": "completed"},
            "SELECT firebase_uid FROM users": {"firebase_uid": owner_uid},
        })

    def test_owner_can_delete_interview(self):
        cursor = self._cursor(FIREBASE_UID)
        with patch.object(main.shutil, "rmtree") as rmtree:
            result, connection = run(cursor, main.delete_interview, INTERVIEW_ID)
        self.assertEqual(result["status"], "deleted")
        self.assertTrue(any(q.startswith("DELETE FROM interviews") for q, _ in cursor.calls))
        self.assertTrue(connection.committed)
        rmtree.assert_called_once()

    def test_other_users_cannot_delete_interview(self):
        cursor = self._cursor("someone-else")
        with self.assertRaises(HTTPException) as ctx:
            run(cursor, main.delete_interview, INTERVIEW_ID)
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertFalse(any(q.startswith("DELETE") for q, _ in cursor.calls))


if __name__ == "__main__":
    unittest.main()
