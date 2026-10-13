"""Strict scoring: skipped answers earn nothing and completion scales the score."""
import unittest
from unittest.mock import patch

import gemini_service
import main
import scoring
from auth import AuthUser
from test_main import FakeConnection, FakeCursor
from test_integrity import ACTIVE, INTERVIEW_ID

USER = AuthUser(uid="firebase-user-abc123")


def _turn(i, answer="A solid answer", quality=80, source="gemini", **extra):
    return {"id": f"r{i}", "question_id": f"q{i}", "question_index": i, "question_text": "Q",
            "candidate_answer": answer, "answer_quality_score": quality, "communication_score": quality,
            "evaluated_at": "now", "criteria_scores": None, "strengths": [], "improvements": [],
            "evaluation_source": source, **extra}


def _score(result, label):
    return next(s["value"] for s in result["scores"] if s["label"] == label)


def _complete(responses, ended_early=False, summarize=None):
    class Cursor(FakeCursor):
        def fetchone(self):
            if "SELECT * FROM interviews" in self.last_query:
                return dict(ACTIVE)
            return super().fetchone()
    cursor = Cursor(responses=responses)
    patches = [patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)),
               patch.object(main.gemini_service, "summarize_interview", side_effect=summarize or (lambda *a, **k: None))]
    with patches[0], patches[1] as summary:
        result = main.complete_and_evaluate_interview(
            INTERVIEW_ID, main.EvaluateInterviewRequest(ended_early=ended_early), user=USER)
    return result, summary


class NonAnswerEvaluationTests(unittest.TestCase):
    def test_skip_scores_zero_without_calling_gemini(self):
        with patch.object(gemini_service, "get_client") as get_client:
            result = gemini_service.evaluate_answer_with_rag("Q", "Skip.", [], 0.0, 0)
        get_client.assert_not_called()
        self.assertEqual((result["answer_quality_score"], result["communication_score"]), (0, 0))
        self.assertEqual(result["evaluation_source"], "skipped")

    def test_criteria_weights(self):
        self.assertEqual(gemini_service.CRITERIA_WEIGHTS,
                         {"correctness": 0.50, "completeness": 0.20, "technical_depth": 0.20, "relevance": 0.10})
        self.assertEqual(gemini_service.answer_quality_from_criteria(
            {"correctness": 100, "completeness": 0, "technical_depth": 0, "relevance": 0}), 50)


class CompletionRuleTests(unittest.TestCase):
    def test_completion_counts(self):
        comp = scoring.completion([_turn(1), _turn(2), _turn(3, "skip"), _turn(4, ""), _turn(5, "idk")], 5)
        self.assertEqual({k: comp[k] for k in ("answered", "total", "skipped", "rate_percent")},
                         {"answered": 2, "total": 5, "skipped": 3, "rate_percent": 40})

    def test_final_score(self):
        self.assertEqual(scoring.final_score(80, scoring.completion([_turn(1), _turn(2)], 5)), 32)
        self.assertEqual(scoring.final_score(80, scoring.completion([_turn(i) for i in range(1, 6)], 5)), 80)
        self.assertEqual(scoring.final_score(100, scoring.completion([_turn(1, "skip")], 1)), 0)

    def test_coding_turns(self):
        code = {"candidate_answer": "print(1)", "coding_result": {"passed": 1}}
        blank = {"candidate_answer": "  ", "coding_result": {"passed": 0}}
        self.assertTrue(scoring.is_substantive(code))
        self.assertFalse(scoring.is_substantive(blank))

    def test_penalised_answer_is_still_an_attempt(self):
        self.assertTrue(scoring.is_substantive(_turn(1, quality=0)))


class CompleteEndpointTests(unittest.TestCase):
    def test_all_skipped_scores_zero_and_skips_gemini_summary(self):
        responses = [_turn(i, "skip", 0, "skipped", vision_metrics={"eyeContact": 100, "facePresence": 100,
                                                                   "cameraFacing": 100, "framesAnalyzed": 100})
                     for i in range(1, 6)]
        result, summary = _complete(responses)
        summary.assert_not_called()
        self.assertEqual(result["overall_score"], 0)
        self.assertEqual(_score(result, "Answer Quality"), 0)
        self.assertEqual(_score(result, "Communication"), 0)
        self.assertTrue(result["insufficient_responses"])
        self.assertEqual(result["completion"]["answered"], 0)
        self.assertIn("Insufficient substantive responses", result["feedback"])
        self.assertNotIn("filler", result["feedback"])
        speech = next(s for s in result["scores"] if s["label"] == "Speech Fluency")
        self.assertIsNone(speech["value"])
        self.assertIn("Camera Engagement", [s["label"] for s in result["scores"]])

    def test_all_empty_scores_zero(self):
        result, _ = _complete([_turn(i, "", 0, "empty") for i in range(1, 6)])
        self.assertEqual(result["overall_score"], 0)
        self.assertIsNone(result["speech_fluency_score"])

    def test_two_of_five_scales_without_double_penalty(self):
        responses = [_turn(1), _turn(2)] + [_turn(i, "skip", 0, "skipped") for i in (3, 4, 5)]
        result, _ = _complete(responses)
        self.assertEqual(_score(result, "Answer Quality"), 80)
        self.assertEqual(result["completion"]["rate_percent"], 40)
        weighted = scoring.overall_score(80, 80, None, scoring.speech_fluency(0, 2))
        self.assertEqual(result["overall_score"], round(weighted * 0.4))
        self.assertIn("You answered 2 of 5 questions", result["feedback"])

    def test_all_answered_has_no_penalty(self):
        result, _ = _complete([_turn(i) for i in range(1, 6)])
        self.assertEqual(result["overall_score"], scoring.overall_score(80, 80, None, 95))

    def test_early_end_is_not_zero_padded(self):
        result, _ = _complete([_turn(1), _turn(2)], ended_early=True)
        self.assertEqual(_score(result, "Answer Quality"), 80)
        self.assertEqual(result["overall_score"],
                         round(scoring.overall_score(80, 80, None, 95) * 0.4))

    def test_zeroed_answer_stays_in_the_average(self):
        responses = [_turn(1), _turn(2)] + [_turn(i, "skip", 0, "skipped") for i in (3, 4, 5)]
        zero = {"action": "zero", "flags": []}
        assessments = ({1: {"action": None, "flags": []}, 2: zero}, {"face_mismatch_events": 0})
        with patch.object(main.assessment, "assess", return_value=(assessments[0],
                          {"face_mismatch_events": 0})), patch.object(main.assessment, "store"):
            result, _ = _complete(responses)
        self.assertEqual(_score(result, "Answer Quality"), 40)
        self.assertEqual(result["completion"]["answered"], 2)


if __name__ == "__main__":
    unittest.main()
