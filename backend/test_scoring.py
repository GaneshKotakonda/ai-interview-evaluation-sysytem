"""Tests for the refactored scoring rules and the bugs fixed alongside them."""
import os
import sys
import unittest
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(__file__))
from fastapi import HTTPException, UploadFile

import adaptive_service
import config
import gemini_service
import main
import nlp_evaluator
import scoring
from adaptive_questions import fallback_question
from test_main import FakeConnection, FakeCursor, INTERVIEW_ID


class ScoringRuleTests(unittest.TestCase):
    def test_camera_engagement_is_clamped_or_missing(self):
        self.assertEqual(scoring.camera_engagement({"eyeContact": 80}), 80)
        self.assertEqual(scoring.camera_engagement({"eyeContact": "64.6"}), 65)
        self.assertEqual(scoring.camera_engagement({"eyeContact": 1000}), 100)
        self.assertEqual(scoring.camera_engagement({"eyeContact": -5}), 0)
        for missing in (None, {}, {"eyeContact": None}, {"eyeContact": "n/a"},
                        {"eyeContact": True}, {"eyeContact": float("nan")}):
            with self.subTest(missing=missing):
                self.assertIsNone(scoring.camera_engagement(missing))

    def test_overall_score_drops_missing_camera_weight(self):
        self.assertEqual(scoring.overall_score(80, 80, 80, 80), 80)
        # 0.40*90 + 0.25*70 + 0.15*80 = 65.5 over a weight of 0.80 -> 81.875
        self.assertEqual(scoring.overall_score(90, 70, None, 80), 82)

    def test_speech_fluency_is_normalised_per_answer(self):
        self.assertEqual(scoring.speech_fluency(0, 5), 95)
        self.assertEqual(scoring.speech_fluency(10, 5), 91)  # 2 fillers per answer
        self.assertEqual(scoring.speech_fluency(10, 1), 75)
        self.assertEqual(scoring.speech_fluency(500, 1), 50)
        self.assertEqual(scoring.speech_fluency(0, 0), 95)

    def test_filler_aggregation_and_average(self):
        summary = scoring.aggregate_fillers(["Um, like, I think", None, "you know, um"])
        self.assertEqual(summary, {"total_fillers": 4, "breakdown": {"um": 2, "like": 1, "you know": 1}})
        self.assertEqual(scoring.average_score([80, None, 90]), 85)
        self.assertEqual(scoring.average_score([]), scoring.NEUTRAL_SCORE)


class EndpointFixTests(unittest.TestCase):
    def test_completion_without_camera_data_omits_camera_score(self):
        cursor = FakeCursor(responses=[{
            "question_index": 1, "question_text": "Q", "candidate_answer": "Answer",
            "semantic_similarity_score": 0.8,
        }])
        evaluation = {"question_evaluations": [{"answer_quality_score": 90, "communication_score": 70}],
                      "overall_summary": ""}
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)), \
             patch.object(main.gemini_service, "batch_evaluate_interview", return_value=evaluation):
            result = main.complete_and_evaluate_interview(INTERVIEW_ID, main.EvaluateInterviewRequest())
        self.assertNotIn("Camera Engagement", [s["label"] for s in result["scores"]])
        self.assertIsNone(result["camera_engagement_score"])
        self.assertIn("not measured", result["feedback"])
        insert = next(params for query, params in cursor.calls if "INSERT INTO evaluation_reports" in query)
        self.assertIsNone(insert[5])  # camera_engagement_score column

    def test_unexpected_errors_become_generic_500_and_roll_back(self):
        conn = FakeConnection(FakeCursor())
        with patch.object(main.database, "get_db_connection", return_value=conn), \
             patch.object(main.adaptive_service, "advance", side_effect=RuntimeError("secret detail")):
            with self.assertRaises(HTTPException) as caught:
                main.next_question(INTERVIEW_ID)
        self.assertEqual(caught.exception.status_code, 500)
        self.assertNotIn("secret", caught.exception.detail)
        self.assertTrue(conn.rolled_back)
        self.assertTrue(conn.closed)

    def test_oversized_video_is_rejected_and_removed(self):
        with TemporaryDirectory() as directory, patch.object(main, "UPLOAD_DIR", directory), \
             patch.object(config, "MAX_UPLOAD_MB", 1):
            big = UploadFile(filename="a.webm", file=BytesIO(b"x" * (1024 * 1024 + 1)))
            with self.assertRaises(HTTPException) as caught:
                main.save_answer_video(INTERVIEW_ID, 1, big)
            self.assertEqual(caught.exception.status_code, 413)
            self.assertFalse(os.path.exists(os.path.join(directory, INTERVIEW_ID, "q_1.webm")))

    def test_video_url_uses_canonical_uuid(self):
        with TemporaryDirectory() as directory, patch.object(main, "UPLOAD_DIR", directory):
            url = main.save_answer_video(INTERVIEW_ID.upper(), 2, UploadFile(filename="a.webm", file=BytesIO(b"v")))
        self.assertEqual(url, f"/uploads/{INTERVIEW_ID}/q_2.webm")

    def test_report_includes_role_and_turns_without_locking(self):
        report = {"interview_id": INTERVIEW_ID, "overall_score": 81, "answer_quality_score": 85,
                  "communication_score": 80, "speech_fluency_score": 90, "voice_confidence_score": 90,
                  "camera_engagement_score": None, "strengths": ["Clear"], "improvements": [],
                  "summary_feedback": "Good", "nlp_metrics": {"total_fillers": 0}}
        turn = {"question_index": 1, "question_text": "What is REST?", "difficulty": "medium",
                "is_follow_up": False, "topic": "REST", "answer_quality_score": 85, "feedback": "Solid",
                "evaluation_source": "gemini", "next_result": {"adaptation": {"reason": "Raise"}}}

        class ReportCursor(FakeCursor):
            def fetchone(self):
                if "FROM evaluation_reports" in self.last_query:
                    return report
                return super().fetchone()

            def fetchall(self):
                return [turn] if "FROM interview_responses" in self.last_query else []

        cursor = ReportCursor()
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            result = main.get_interview_report(INTERVIEW_ID)
        self.assertEqual(result["role_title"], "Backend Engineer")
        self.assertEqual(result["turns"][0]["question"], "What is REST?")
        self.assertEqual(result["turns"][0]["adaptation"], {"reason": "Raise"})
        self.assertEqual([s["label"] for s in result["scores"]],
                         ["Answer Quality", "Communication", "Speech Fluency"])
        self.assertFalse(any("FOR UPDATE" in query for query, _ in cursor.calls))

    def test_report_rejects_bad_uuid(self):
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(FakeCursor())):
            with self.assertRaises(HTTPException) as caught:
                main.get_interview_report("not-a-uuid")
        self.assertEqual(caught.exception.status_code, 400)


class ServiceFixTests(unittest.TestCase):
    def test_embeddings_request_a_fixed_dimension(self):
        client = MagicMock()
        client.models.embed_content.return_value.embeddings = [MagicMock(values=[0.1] * config.EMBEDDING_DIMENSIONS)]
        with patch.object(gemini_service, "get_client", return_value=client):
            vector = gemini_service.get_embedding("rubric point")
        self.assertEqual(len(vector), config.EMBEDDING_DIMENSIONS)
        sent = client.models.embed_content.call_args.kwargs["config"]
        self.assertEqual(sent.output_dimensionality, config.EMBEDDING_DIMENSIONS)

    def test_wrong_size_embeddings_are_discarded(self):
        client = MagicMock()
        client.models.embed_content.return_value.embeddings = [MagicMock(values=[0.1] * 3072)]
        with patch.object(gemini_service, "get_client", return_value=client):
            self.assertEqual(gemini_service.get_embedding("rubric point"), [])

    def test_empty_text_never_calls_gemini(self):
        with patch.object(gemini_service, "get_client") as get_client:
            self.assertEqual(gemini_service.get_embedding("   "), [])
        get_client.assert_not_called()

    def test_batch_evaluation_without_api_key_uses_local_fallback(self):
        with patch.object(config, "GEMINI_API_KEY", ""):
            result = gemini_service.batch_evaluate_interview("Engineer", None, [
                {"question_index": 1, "similarity_score": 0.9, "filler_count": 0}])
        self.assertEqual(result["question_evaluations"][0]["answer_quality_score"], 90)

    def test_rubric_search_casts_vector_to_float8_array(self):
        class RubricCursor(FakeCursor):
            def fetchall(self):
                return [{"ideal_concept_chunk": "A", "similarity": 0.4},
                        {"ideal_concept_chunk": "B", "similarity": 0.9}]

        cursor = RubricCursor()
        points, best = nlp_evaluator.retrieve_top_rubric_matches(
            FakeConnection(cursor), INTERVIEW_ID, 1, [0.1, 0.2])
        self.assertIn("%s::float8[]", cursor.calls[0][0])
        self.assertEqual((points, best), (["A", "B"], 0.9))

    def test_fallback_topics_never_run_out(self):
        history = [dict(topic=f"Topic {i}", question=f"Q{i}") for i in range(30)]
        history += [dict(topic=t, question=t) for t in fallback_question.__globals__["EXTRA_TOPICS"]]
        history += [dict(topic=t, question=t) for t in fallback_question.__globals__["TOPICS"]["software"]]
        result = fallback_question(dict(role_title="Engineer", current_difficulty="easy",
                                        is_follow_up=False, recent_history=history))
        self.assertTrue(result["question"])

    def test_read_only_fetch_does_not_lock(self):
        cursor = FakeCursor()
        adaptive_service.fetch_interview(cursor, INTERVIEW_ID, lock=False)
        self.assertNotIn("FOR UPDATE", cursor.calls[0][0])
        adaptive_service.lock_interview(cursor, INTERVIEW_ID)
        self.assertIn("FOR UPDATE", cursor.calls[1][0])


if __name__ == "__main__":
    unittest.main()
