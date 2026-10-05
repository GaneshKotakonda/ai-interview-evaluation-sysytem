"""Proctoring: integrity rules, the events endpoint and early termination."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import integrity
import main
from auth import AuthUser
from test_main import FakeConnection, FakeCursor
from test_profile import ScriptedCursor

USER = AuthUser(uid="firebase-user-abc123")
INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"
ACTIVE = {"id": INTERVIEW_ID, "user_id": "u", "status": "in_progress", "current_turn": 2,
          "max_turns": 5, "role_title": "Backend Engineer", "interview_mode": "standard",
          "job_description": ""}


class IntegritySummaryTests(unittest.TestCase):
    def test_clean_minor_and_flagged_levels(self):
        self.assertEqual(integrity.summarize([])["level"], "clean")
        minor = integrity.summarize([{"event_type": "paste_blocked"},
                                     {"event_type": "window_blur", "duration_seconds": 4.5}])
        self.assertEqual((minor["level"], minor["violations"], minor["time_away_seconds"]), ("minor", 1, 4.5))
        flagged = integrity.summarize([{"event_type": "tab_hidden", "duration_seconds": 10}] * 3)
        self.assertEqual((flagged["level"], flagged["violations"]), ("flagged", 3))
        self.assertEqual(integrity.summarize([], {"multipleFaceEvents": 2})["level"], "flagged")
        self.assertTrue(integrity.summarize([], ended_early=True)["ended_early"])

    def test_only_leaving_the_interview_counts_as_a_violation(self):
        self.assertTrue(integrity.is_major(["window_blur", "tab_hidden"]))
        self.assertFalse(integrity.is_major(["copy_blocked", "multiple_displays"]))


class ProctoringEndpointTests(unittest.TestCase):
    def _post(self, events, interview=None):
        cursor = ScriptedCursor(one={"SELECT * FROM interviews": interview or dict(ACTIVE)},
                                many={"SELECT event_type, duration_seconds": [{"event_type": "window_blur",
                                                                               "duration_seconds": 3}]})
        payload = main.ProctoringBatch(events=[main.ProctoringEvent(**e) for e in events])
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            return main.record_proctoring_events(INTERVIEW_ID, payload, user=USER), cursor

    def test_events_are_stored_idempotently_and_unknown_types_ignored(self):
        result, cursor = self._post([
            {"id": "e1", "type": "window_blur", "question_index": 2, "part": 1, "at": 42.5, "duration": 3},
            {"id": "e2", "type": "not-a-real-event"},
        ])
        inserts = [c for c in cursor.calls if c[0].startswith("INSERT INTO proctoring_events")]
        self.assertEqual(len(inserts), 1)
        self.assertIn("ON CONFLICT (interview_id, client_event_id)", inserts[0][0])
        self.assertEqual(inserts[0][1][1:7], ("e1", "window_blur", 2, 1, 42.5, 3))
        self.assertEqual(result, {"stored": 1, "violations": 1, "max_violations": main.config.PROCTORING_MAX_VIOLATIONS})

    def test_arena_and_finished_interviews_are_refused(self):
        for interview in ({**ACTIVE, "interview_mode": "game"}, {**ACTIVE, "status": "completed"}):
            with self.subTest(interview=interview), self.assertRaises(HTTPException) as ctx:
                self._post([{"id": "e", "type": "window_blur"}], interview)
            self.assertEqual(ctx.exception.status_code, 409)


class EarlyTerminationTests(unittest.TestCase):
    def _complete(self, responses):
        class Cursor(FakeCursor):
            def fetchone(self):
                if "SELECT * FROM interviews" in self.last_query:
                    return dict(ACTIVE)
                return super().fetchone()
        cursor = Cursor(responses=responses)
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            result = main.complete_and_evaluate_interview(
                INTERVIEW_ID, main.EvaluateInterviewRequest(ended_early=True), user=USER)
        return result, cursor

    def test_unanswered_questions_score_zero_and_interview_is_marked(self):
        answered = [{"question_id": f"q{i}", "question_index": i, "question_text": "Q", "candidate_answer": "A",
                     "answer_quality_score": 90, "communication_score": 80, "evaluated_at": "now",
                     "criteria_scores": None, "strengths": [], "improvements": []} for i in (1, 2)]
        result, cursor = self._complete(answered)
        self.assertEqual(result["scores"][0], {"label": "Answer Quality", "value": 36})  # (90+90)/5
        self.assertTrue(result["integrity"]["ended_early"])
        self.assertEqual(result["integrity"]["level"], "flagged")
        self.assertTrue(result["feedback"].startswith("This interview ended early"))
        update = next(c for c in cursor.calls if "UPDATE interviews" in c[0])
        self.assertEqual(update[1][2:4], (True, "integrity"))

    def test_ending_before_any_answer_still_produces_a_report(self):
        result, _ = self._complete([])
        self.assertEqual(result["overall_score"], 0)
        self.assertNotIn("Speech Fluency", [s["label"] for s in result["scores"]])

    def test_without_ended_early_all_turns_are_still_required(self):
        class Cursor(FakeCursor):
            def fetchone(self):
                return dict(ACTIVE) if "SELECT * FROM interviews" in self.last_query else super().fetchone()
        answered = [{"question_id": "q1", "question_index": 1, "question_text": "Q", "candidate_answer": "A",
                     "answer_quality_score": 90, "communication_score": 80, "evaluated_at": "now"}]
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(Cursor(responses=answered))):
            with self.assertRaises(HTTPException) as ctx:
                main.complete_and_evaluate_interview(INTERVIEW_ID, main.EvaluateInterviewRequest(), user=USER)
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
