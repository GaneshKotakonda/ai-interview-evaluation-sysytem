import os
import sys
import unittest
from unittest.mock import patch


BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import main


USER_ID = "11111111-1111-1111-1111-111111111111"
INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"
REPORT_ID = "33333333-3333-3333-3333-333333333333"
FIREBASE_UID = "firebase-user-abc123"


class FakeCursor:
    def __init__(self, *, user_exists=False, history=None, responses=None):
        self.user_exists = user_exists
        self.history = history or []
        self.responses = responses or []
        self.calls = []
        self.last_query = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, query, params=None):
        self.last_query = " ".join(query.split())
        self.calls.append((self.last_query, params))

    def fetchone(self):
        if "SELECT id FROM users WHERE firebase_uid" in self.last_query:
            return {"id": USER_ID} if self.user_exists else None
        if "INSERT INTO users" in self.last_query:
            return {"id": USER_ID}
        if "INSERT INTO interviews" in self.last_query:
            return {"id": INTERVIEW_ID}
        if "SELECT * FROM interviews" in self.last_query:
            return {"id": INTERVIEW_ID, "job_description": "Build APIs",
                    "role_title": "Backend Engineer", "status": "in_progress", "max_turns": 5}
        if "INSERT INTO interview_questions" in self.last_query:
            return {"id": REPORT_ID, "question_index": 1, "question_text": "Explain APIs.",
                    "difficulty": "medium", "is_follow_up": False, "topic": "APIs"}
        if "INSERT INTO evaluation_reports" in self.last_query:
            return {"id": REPORT_ID}
        return None

    def fetchall(self):
        if "FROM interviews" in self.last_query and "ORDER BY created_at DESC" in self.last_query:
            return self.history
        if "FROM interview_responses" in self.last_query:
            return self.responses
        if "FROM question_rubrics" in self.last_query:
            return [{"ideal_concept_chunk": "Explain the trade-off"}]
        return []


class FakeConnection:
    def __init__(self, cursor):
        self.fake_cursor = cursor
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class InterviewApiTests(unittest.TestCase):
    def test_start_interview_creates_firebase_user_and_uses_internal_uuid(self):
        cursor = FakeCursor(user_exists=False)
        connection = FakeConnection(cursor)
        payload = main.StartInterviewRequest(
            firebase_uid=FIREBASE_UID,
            email="candidate@example.com",
            full_name="Candidate Name",
            role_title="Backend Engineer",
            job_description="Build APIs",
        )

        with patch.object(main.database, "get_db_connection", return_value=connection), patch.object(
            main.gemini_service, "generate_adaptive_question", return_value={
                "question": "Explain APIs.", "difficulty": "medium", "is_follow_up": False,
                "topic": "APIs", "adaptive_reason": "Initial question",
                "rubric_points": ["Contracts"],
            }
        ), patch.object(main.gemini_service, "get_embedding", return_value=[]):
            result = main.start_interview(payload)

        user_insert = next(call for call in cursor.calls if "INSERT INTO users" in call[0])
        interview_insert = next(call for call in cursor.calls if "INSERT INTO interviews" in call[0])
        self.assertEqual(
            user_insert[1],
            (FIREBASE_UID, "candidate@example.com", "Candidate Name"),
        )
        self.assertEqual(interview_insert[1][0], USER_ID)
        self.assertEqual(result["interview_id"], INTERVIEW_ID)
        self.assertTrue(connection.committed)
        self.assertEqual(len(result["questions"]), 1)
        self.assertNotIn("rubric_points", result["question"])

    def test_history_resolves_firebase_uid_before_loading_interviews(self):
        history = [
            {
                "id": INTERVIEW_ID,
                "role_title": "Backend Engineer",
                "status": "completed",
                "duration_seconds": 420,
                "overall_score": 88,
                "created_at": "2026-09-27T10:00:00Z",
                "completed_at": "2026-09-27T10:07:00Z",
            }
        ]
        cursor = FakeCursor(user_exists=True, history=history)
        connection = FakeConnection(cursor)

        with patch.object(main.database, "get_db_connection", return_value=connection):
            result = main.get_user_interviews(FIREBASE_UID)

        self.assertEqual(result, history)
        history_query = next(
            call for call in cursor.calls if "FROM interviews" in call[0] and "ORDER BY created_at DESC" in call[0]
        )
        self.assertEqual(history_query[1], (USER_ID,))

    def test_history_returns_empty_list_when_firebase_user_does_not_exist(self):
        cursor = FakeCursor(user_exists=False)
        connection = FakeConnection(cursor)

        with patch.object(main.database, "get_db_connection", return_value=connection):
            result = main.get_user_interviews("unknown-firebase-user")

        self.assertEqual(result, [])
        self.assertFalse(any("FROM interviews" in query for query, _ in cursor.calls))

    def test_completion_persists_completed_status_score_and_duration(self):
        cursor = FakeCursor(
            responses=[
                {
                    "question_index": 1,
                    "question_text": "How do you design an API?",
                    "candidate_answer": "I start from the resource model.",
                    "semantic_similarity_score": 0.8,
                }
            ]
        )
        connection = FakeConnection(cursor)
        payload = main.EvaluateInterviewRequest(
            vision_metrics={"eyeContact": 80},
            duration_seconds=420,
        )
        evaluation = {
            "question_evaluations": [
                {
                    "answer_quality_score": 90,
                    "communication_score": 80,
                    "strengths": ["Structured"],
                    "improvements": ["Add examples"],
                }
            ],
            "overall_strengths": [],
            "overall_improvements": [],
            "overall_summary": "Strong structured response.",
        }

        with patch.object(main.database, "get_db_connection", return_value=connection), patch.object(
            main.gemini_service, "batch_evaluate_interview", return_value=evaluation
        ):
            result = main.complete_and_evaluate_interview(INTERVIEW_ID, payload)

        update_call = next(call for call in cursor.calls if "UPDATE interviews" in call[0])
        self.assertIn("status = 'completed'", update_call[0])
        self.assertIn("duration_seconds = %s", update_call[0])
        self.assertEqual(update_call[1], (result["overall_score"], 420, INTERVIEW_ID))
        self.assertTrue(connection.committed)


if __name__ == "__main__":
    unittest.main()
