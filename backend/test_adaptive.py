import json
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(__file__))
from adaptive import determine_next_difficulty, should_generate_follow_up
import adaptive_service as service
import gemini_service
import main
from auth import AuthUser

TEST_USER = AuthUser(uid="firebase-user-abc123")
from test_main import FakeConnection, FakeCursor
from adaptive_questions import fallback_question

INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"


def interview(turn=1, maximum=5):
    return dict(id=INTERVIEW_ID, current_turn=turn, max_turns=maximum,
                current_difficulty="medium", role_title="Backend Engineer",
                job_description="Build APIs", status="in_progress")


def response(turn=1, score=90, follow_up=False):
    return dict(id="33333333-3333-3333-3333-333333333333", question_id="question-id",
                question_index=turn, difficulty="medium", is_follow_up=follow_up,
                topic="REST", question_text="What is REST?", candidate_answer="Stateless requests.",
                answer_quality_score=score, communication_score=80, strengths=["Stateless requests"],
                improvements=["Explain idempotency"], missing_concepts=["Idempotency"],
                feedback="Partial coverage", evaluation_source="gemini",
                evaluated_at="2026-09-27", next_result=None)


class TurnCursor:
    """Persistent fake query boundary for duplicate advancement tests."""
    def __init__(self, state, answer):
        self.state, self.answer = state, answer
        self.questions = []
        self.query = ""
        self.calls = []

    def execute(self, query, params=None):
        self.query = " ".join(query.split())
        self.calls.append((self.query, params))
        if self.query.startswith("UPDATE interviews"):
            self.state.update(current_turn=params[0], current_difficulty=params[1])
        if self.query.startswith("UPDATE interview_responses"):
            self.answer["next_result"] = json.loads(params[0])
        if self.query.startswith("INSERT INTO interview_questions"):
            self.questions.append(dict(id="generated-question", question_index=params[1],
                                       question_text=params[2], difficulty=params[3],
                                       is_follow_up=params[4], topic=params[5]))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def fetchone(self):
        if self.query.startswith("SELECT * FROM interviews"):
            return self.state
        if "SELECT * FROM interview_responses" in self.query:
            return self.answer
        if self.query.startswith("INSERT INTO interview_questions"):
            return self.questions[-1]

    def fetchall(self):
        return [dict(topic="REST", question="What is REST?", difficulty="medium", score=90)]


class AdaptiveTests(unittest.TestCase):
    def test_rubric_disclosure_and_malformed_evaluation_use_safe_fallback(self):
        rubric = "PUT requests must produce the same resource state when repeated."
        base = dict(answer_quality_score=85, communication_score=80, strengths=["Good"],
                    improvements=[], missing_concepts=[], feedback="Good explanation.")
        for data in (
            {**base, "feedback": rubric},
            {**base, "missing_concepts": [rubric]},
            {**base, "answer_quality_score": 200},
            {**base, "answer_quality_score": True},
            {**base, "strengths": "bad shape"},
        ):
            client = MagicMock()
            client.models.generate_content.return_value.text = json.dumps(data)
            with patch.object(gemini_service, "get_client", return_value=client):
                result = gemini_service.evaluate_answer_with_rag("q", "answer", [rubric], 0.5, 1)
            self.assertEqual(result["evaluation_source"], "fallback")
            self.assertNotIn(rubric, json.dumps(result))

    def test_completion_retry_has_identical_contract(self):
        answers = [{**response(i), "semantic_similarity_score": 0.8} for i in range(1, 6)]

        class ReportCursor(FakeCursor):
            saved_report = None
            completed = False

            def execute(self, query, params=None):
                super().execute(query, params)
                if "INSERT INTO evaluation_reports" in query:
                    fields = ("interview_id", "answer_quality_score", "communication_score",
                              "voice_confidence_score", "speech_fluency_score", "camera_engagement_score", "overall_score",
                              "vision_metrics", "nlp_metrics", "strengths", "improvements", "summary_feedback",
                              "criteria_scores", "speech_metrics", "scoring_version", "scoring_weights")
                    self.saved_report = dict(zip(fields, params))
                    # psycopg2 returns JSONB columns as Python objects.
                    for key in ("vision_metrics", "nlp_metrics", "criteria_scores", "speech_metrics", "scoring_weights"):
                        if isinstance(self.saved_report.get(key), str):
                            self.saved_report[key] = json.loads(self.saved_report[key])
                if "SET status = 'completed'" in query:
                    self.completed = True

            def fetchone(self):
                if "SELECT * FROM evaluation_reports" in self.last_query:
                    return self.saved_report
                row = super().fetchone()
                if "SELECT * FROM interviews" in self.last_query and self.completed:
                    row["status"] = "completed"
                return row

        conn = FakeConnection(ReportCursor(responses=answers))
        with patch.object(main.database, "get_db_connection", return_value=conn):
            first = main.complete_and_evaluate_interview(INTERVIEW_ID, main.EvaluateInterviewRequest(), user=TEST_USER)
            replay = main.complete_and_evaluate_interview(INTERVIEW_ID, main.EvaluateInterviewRequest(), user=TEST_USER)
        self.assertEqual(first, replay)

    def test_submission_evaluates_once_uses_server_question_and_preserves_video(self):
        from io import BytesIO
        from tempfile import TemporaryDirectory
        from fastapi import UploadFile
        question = dict(id="44444444-4444-4444-4444-444444444444",
                        question_index=1, question_text="What is REST?", difficulty="medium",
                        is_follow_up=False, topic="REST", adaptive_reason="Initial question",
                        rubric_points=["HTTP resource semantics"])

        class SubmissionCursor(TurnCursor):
            def fetchone(self):
                if "SELECT * FROM interview_questions" in self.query:
                    return question
                if "INSERT INTO interview_responses" in self.query:
                    fields = ("interview_id", "question_id", "question_index", "question_text",
                              "candidate_answer", "answer_embedding", "semantic_similarity_score",
                              "video_url", "difficulty", "is_follow_up", "topic", "adaptive_reason",
                              "answer_quality_score", "communication_score", "feedback", "strengths",
                              "improvements", "missing_concepts", "filler_metrics", "evaluation_source")
                    self.answer = dict(zip(fields, self.calls[-1][1]))
                    for field in ("strengths", "improvements", "missing_concepts", "filler_metrics"):
                        self.answer[field] = json.loads(self.answer[field])
                    self.answer.update(id="33333333-3333-3333-3333-333333333333",
                                       next_result=None, evaluated_at="today")
                    return self.answer
                return super().fetchone()

        cursor = SubmissionCursor(interview(), None)
        conn = FakeConnection(cursor)
        evaluation = service.public_evaluation(response())
        with TemporaryDirectory() as directory, patch.object(main, "UPLOAD_DIR", directory), patch.object(
            main.database, "get_db_connection", return_value=conn
        ), patch.object(gemini_service, "get_embedding", return_value=[]), patch.object(
            gemini_service, "evaluate_answer_with_rag", return_value=evaluation
        ) as evaluate:
            first = main.submit_answer(INTERVIEW_ID, 1, "Client forged question", "An answer",
                                       UploadFile(filename="video.webm", file=BytesIO(b"recording")), user=TEST_USER)
            replay = main.submit_answer(INTERVIEW_ID, 1, "Client forged question", "An answer", None, user=TEST_USER)
            self.assertEqual(first, replay)
            self.assertEqual(evaluate.call_count, 1)
            self.assertEqual(evaluate.call_args.args[0], "What is REST?")
            self.assertEqual(first["video_url"], f"/uploads/{INTERVIEW_ID}/q_1.webm")
            with open(os.path.join(directory, INTERVIEW_ID, "q_1.webm"), "rb") as video:
                self.assertEqual(video.read(), b"recording")
            with self.assertRaises(service.HTTPException) as caught:
                main.submit_answer(INTERVIEW_ID, 1, "q", "Changed answer", None, user=TEST_USER)
            self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(cursor.answer["answer_quality_score"], 90)
        self.assertEqual(cursor.answer["difficulty"], "medium")
        self.assertIsNotNone(cursor.answer["filler_metrics"])

    @patch.object(gemini_service, "get_embedding", return_value=[])
    def test_next_endpoint_locks_commits_and_replays(self, embedding):
        state, answer = interview(), response()
        cursor = TurnCursor(state, answer)
        conn = FakeConnection(cursor)
        with patch.object(main.database, "get_db_connection", return_value=conn), patch.object(
            gemini_service, "generate_adaptive_question", side_effect=lambda **ctx: fallback_question(ctx)
        ):
            result = main.next_question(INTERVIEW_ID, user=TEST_USER)
            replay = main.next_question(INTERVIEW_ID, user=TEST_USER)
        self.assertEqual(result, replay)
        self.assertTrue(conn.committed)
        self.assertTrue(conn.closed)
        self.assertIn("FOR UPDATE", cursor.calls[0][0])

    def test_next_endpoint_unknown_session_is_404(self):
        conn = FakeConnection(TurnCursor(None, None))
        with patch.object(main.database, "get_db_connection", return_value=conn):
            with self.assertRaises(service.HTTPException) as caught:
                main.next_question(INTERVIEW_ID, user=TEST_USER)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertTrue(conn.rolled_back)

    @patch.object(gemini_service, "get_embedding", return_value=[])
    def test_partial_follow_up_then_new_topic(self, embedding):
        state, answer = interview(), response(score=60)
        cursor = TurnCursor(state, answer)
        with patch.object(gemini_service, "generate_adaptive_question",
                          side_effect=lambda **ctx: fallback_question(ctx)):
            first = service.advance(cursor, state)
            self.assertTrue(first["adaptation"]["is_follow_up"])
            self.assertEqual(first["next_question"]["topic"], "REST")
            cursor.answer = response(turn=2, score=60, follow_up=True)
            second = service.advance(cursor, state)
        self.assertFalse(second["adaptation"]["is_follow_up"])
        self.assertNotEqual(second["next_question"]["topic"], "REST")

    def test_fallback_categories_and_full_session_do_not_repeat(self):
        for role in ("Frontend engineer", "Backend engineer", "Database engineer",
                     "General programming", "Software engineer"):
            history = []
            for turn in range(1, 21):
                result = fallback_question(dict(
                    role_title=role, current_difficulty="medium", is_follow_up=False,
                    recent_history=history, turn_number=turn,
                ))
                self.assertNotIn(result["question"], [h["question"] for h in history])
                history.append(dict(topic=result["topic"], question=result["question"]))

    def test_completion_aggregates_saved_scores_without_ai(self):
        answers = [
            {**response(turn=i), "question_id": f"question-{i}", "semantic_similarity_score": 0.8}
            for i in range(1, 6)
        ]
        cursor = FakeCursor(responses=answers)
        conn = FakeConnection(cursor)
        with patch.object(main.database, "get_db_connection", return_value=conn), patch.object(
            gemini_service, "batch_evaluate_interview"
        ) as batch, patch.object(gemini_service, "evaluate_answer_with_rag") as evaluate:
            result = main.complete_and_evaluate_interview(
                INTERVIEW_ID, main.EvaluateInterviewRequest(duration_seconds=300, vision_metrics={"eyeContact": 80}), user=TEST_USER
            )
        self.assertEqual(result["scores"][0]["value"], 90)
        self.assertEqual(result["scores"][1]["value"], 80)
        batch.assert_not_called()
        evaluate.assert_not_called()

    def test_early_completion_is_rejected(self):
        conn = FakeConnection(FakeCursor(responses=[response()]))
        with patch.object(main.database, "get_db_connection", return_value=conn):
            with self.assertRaises(service.HTTPException) as caught:
                main.complete_and_evaluate_interview(INTERVIEW_ID, main.EvaluateInterviewRequest(), user=TEST_USER)
        self.assertEqual(caught.exception.status_code, 409)

    def test_thresholds_and_bounds(self):
        cases = [
            ("medium", 90, "hard"), ("hard", 40, "medium"), ("expert", 100, "expert"),
            ("easy", 20, "easy"), ("medium", 75, "medium"), ("medium", 49, "easy"),
            ("medium", 50, "medium"), ("medium", 69, "medium"), ("medium", 70, "medium"),
            ("medium", 84, "medium"), ("medium", 85, "hard"), ("hard", 90, "expert"),
            ("easy", 0, "easy"), ("expert", 0, "hard"),
        ]
        for current, score, expected in cases:
            with self.subTest(current=current, score=score):
                self.assertEqual(determine_next_difficulty(current, score), expected)

    def test_follow_up_requires_evidence_and_stops_after_one(self):
        for score, previous, gaps, strengths, expected in [
            (60, False, ["Idempotency"], ["Stateless"], True),
            (60, True, ["Idempotency"], ["Stateless"], False),
            (60, False, [], ["Stateless"], False),
            (60, False, ["Idempotency"], [], False),
            (49, False, ["Idempotency"], ["Stateless"], False),
            (50, False, ["Idempotency"], ["Stateless"], True),
            (69, False, ["Idempotency"], ["Stateless"], True),
            (70, False, ["Idempotency"], ["Stateless"], False),
        ]:
            with self.subTest(score=score, previous=previous, gaps=gaps, strengths=strengths):
                self.assertEqual(should_generate_follow_up(score, previous, gaps, strengths), expected)
        self.assertFalse(should_generate_follow_up(60, False, ["gap"], ["idea"], "fallback"))

    @patch.object(gemini_service, "get_embedding", return_value=[])
    def test_advance_and_duplicate_replay(self, embedding):
        state, answer = interview(), response()
        cursor = TurnCursor(state, answer)
        with patch.object(gemini_service, "generate_adaptive_question",
                          side_effect=lambda **ctx: fallback_question(ctx)) as generate:
            result = service.advance(cursor, state)
            replay = service.advance(cursor, state)
        self.assertEqual(result, replay)
        self.assertEqual(result["current_turn"], 2)
        self.assertEqual(result["adaptation"]["previous_difficulty"], "medium")
        self.assertEqual(result["adaptation"]["next_difficulty"], "hard")
        self.assertEqual(result["next_question"]["difficulty"], "hard")
        self.assertFalse(result["is_complete"])
        self.assertNotIn("game", result)
        self.assertNotIn("boss_round", result["next_question"])
        self.assertEqual(len(cursor.questions), 1)
        self.assertEqual(generate.call_count, 1)
        self.assertNotIn("rubric_points", result["next_question"])

    @patch.object(gemini_service, "generate_adaptive_question")
    def test_final_turn_never_generates_question(self, generate):
        state, answer = interview(5), response(5)
        cursor = TurnCursor(state, answer)
        result = service.advance(cursor, state)
        self.assertTrue(result["is_complete"])
        self.assertIsNone(result["next_question"])
        self.assertEqual(result["current_turn"], 5)
        self.assertEqual(state["status"], "in_progress")
        generate.assert_not_called()

    def test_missing_answer_and_completed_interview_rejected(self):
        for state, answer, code in [(interview(), None, 409),
                                    ({**interview(), "status": "completed"}, response(), 409)]:
            with self.assertRaises(service.HTTPException) as caught:
                service.advance(TurnCursor(state, answer), state)
            self.assertEqual(caught.exception.status_code, code)

    def test_malformed_and_unavailable_generation_fall_back(self):
        context = dict(role_title="Backend Engineer", current_difficulty="hard",
                       is_follow_up=False, recent_history=[], turn_number=2, max_turns=5)
        for text in ("not json", "[]", '{"question": 9}', '{"question":"x","rubric_points":[]}'):
            client = MagicMock()
            client.models.generate_content.return_value.text = text
            with patch.object(gemini_service, "get_client", return_value=client):
                result = gemini_service.generate_adaptive_question(**context)
            self.assertEqual(result["difficulty"], "hard")
            self.assertIn("Fallback", result["adaptive_reason"])
        with patch.object(gemini_service, "get_client", side_effect=ValueError("unavailable")):
            self.assertTrue(gemini_service.generate_adaptive_question(**context)["rubric_points"])

    def test_model_cannot_override_policy(self):
        client = MagicMock()
        client.models.generate_content.return_value.text = json.dumps(dict(
            question="How would you prevent lost updates?", topic="Concurrency",
            difficulty="easy", is_follow_up=True, adaptive_reason="Probe tradeoffs",
            rubric_points=["Version checks"],
        ))
        with patch.object(gemini_service, "get_client", return_value=client):
            result = gemini_service.generate_adaptive_question(
                role_title="Backend", current_difficulty="hard", is_follow_up=False, recent_history=[])
        self.assertEqual(result["difficulty"], "hard")
        self.assertFalse(result["is_follow_up"])

    def test_empty_and_failed_evaluations_are_honest(self):
        with patch.object(gemini_service, "get_client", side_effect=ValueError("offline")):
            empty = gemini_service.evaluate_answer_with_rag("q", "", ["private"], 0, 0)
            offline = gemini_service.evaluate_answer_with_rag("q", "An answer", ["private"], 0, 2)
        self.assertEqual(empty["answer_quality_score"], 0)
        self.assertEqual(offline["evaluation_source"], "fallback")
        self.assertEqual(offline["strengths"], [])
        self.assertEqual(offline["missing_concepts"], [])


if __name__ == "__main__":
    unittest.main()
