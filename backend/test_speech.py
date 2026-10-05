"""Speech-to-text, delivery metrics, multi-criteria grading, scoring v2,
answer media and interview-state endpoints."""
import json
import os
import tempfile
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import gemini_service
import main
import scoring
import speech_analysis
import stt_service
from auth import AuthUser
from test_main import FakeConnection
from test_profile import ScriptedCursor

USER = AuthUser(uid="firebase-user-abc123")
INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"
INTERVIEW = {"id": INTERVIEW_ID, "user_id": "u", "status": "in_progress", "current_turn": 1,
             "max_turns": 2, "role_title": "Backend Engineer", "interview_mode": "standard"}
QUESTION = {"id": "q1", "question_index": 1, "question_text": "Explain locking.", "difficulty": "medium",
            "is_follow_up": False, "topic": "Concurrency", "rubric_points": ["versions"]}


def timed(text, start=0.0, step=0.4, gap_after=None):
    """Words with evenly spaced timestamps; gap_after={index: seconds}."""
    words, t = [], start
    for index, word in enumerate(text.split()):
        words.append({"word": word, "start": round(t, 2), "end": round(t + step * 0.8, 2), "probability": 0.9})
        t += step + (gap_after or {}).get(index, 0)
    return words


def upload(name="a.webm", content_type="audio/webm", data=b"audio-bytes"):
    return UploadFile(file=BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


# -------------------------------------------------------------
# Speech delivery metrics
# -------------------------------------------------------------
class SpeechAnalysisTests(unittest.TestCase):
    def test_fluent_answer_scores_high_with_reason(self):
        text = "Optimistic locking checks a version at commit and retries when another writer changed the row first"
        metrics = speech_analysis.compute_metrics(timed(text, step=0.45), text)
        self.assertEqual(metrics["word_count"], 16)
        self.assertTrue(110 <= metrics["words_per_minute"] <= 160)
        self.assertEqual(metrics["long_pauses"], 0)
        self.assertGreaterEqual(metrics["delivery_score"], 85)
        self.assertIn("Steady pace", metrics["notes"][0])

    def test_hesitant_answer_is_penalised_for_fillers_and_pauses(self):
        text = "um so uh locking is like um when you uh lock the row and um like wait"
        words = timed(text, step=0.4, gap_after={2: 2.0, 7: 2.5, 11: 1.8})
        metrics = speech_analysis.compute_metrics(words, text)
        self.assertEqual(metrics["long_pauses"], 3)
        self.assertGreater(metrics["fillers_per_minute"], 3)
        self.assertLess(metrics["delivery_score"], 60)
        self.assertTrue(any("filler" in note for note in metrics["notes"]))
        self.assertTrue(any("long pauses" in note for note in metrics["notes"]))

    def test_fast_speech_and_short_answers(self):
        text = " ".join(["word"] * 40)
        fast = speech_analysis.compute_metrics(timed(text, step=0.25), text)
        self.assertGreater(fast["words_per_minute"], 160)
        self.assertTrue(any("fast" in note for note in fast["notes"]))
        short = speech_analysis.compute_metrics(timed("yes it is"), "yes it is")
        self.assertIsNone(short["delivery_score"])
        self.assertIsNone(speech_analysis.compute_metrics([], ""))

    def test_summary_over_answers(self):
        text = "a b c d e f g h i j"
        one = speech_analysis.compute_metrics(timed(text, step=0.5), text)
        summary = speech_analysis.summarize([one, None, one])
        self.assertEqual(summary["answers_with_audio"], 2)
        self.assertEqual(summary["delivery_score"], one["delivery_score"])
        self.assertIsNone(speech_analysis.summarize([None]))


# -------------------------------------------------------------
# Speech-to-text service
# -------------------------------------------------------------
class SttServiceTests(unittest.TestCase):
    def test_echo_words_are_dropped_but_real_repeats_kept(self):
        words = [
            {"word": "but", "start": 15.7, "end": 16.1, "probability": 0.99},
            {"word": "slower.", "start": 16.1, "end": 16.4, "probability": 0.99},
            {"word": "lower.", "start": 16.4, "end": 16.6, "probability": 0.67},
        ]
        self.assertEqual([w["word"] for w in stt_service._drop_echoes(words)], ["but", "slower."])
        repeat = [
            {"word": "very,", "start": 1.0, "end": 1.3, "probability": 0.9},
            {"word": "very", "start": 1.3, "end": 1.6, "probability": 0.8},
        ]
        self.assertEqual(len(stt_service._drop_echoes(repeat)), 2)

    def test_provider_off_and_gemini_fallback(self):
        with patch.object(stt_service.config, "STT_PROVIDER", "off"):
            with self.assertRaises(stt_service.TranscriptionError):
                stt_service.transcribe("x.webm")
        with patch.object(stt_service.config, "STT_PROVIDER", "whisper"), \
                patch.object(stt_service.config, "GEMINI_API_KEY", "key"), \
                patch.object(stt_service, "_transcribe_whisper", side_effect=RuntimeError("no model")), \
                patch.object(gemini_service, "transcribe_audio", return_value="hello there"):
            result = stt_service.transcribe("x.webm")
        self.assertEqual(result["source"], "gemini")
        self.assertEqual(result["words"], [])
        with patch.object(stt_service.config, "STT_PROVIDER", "whisper"), \
                patch.object(stt_service.config, "GEMINI_API_KEY", ""), \
                patch.object(stt_service, "_transcribe_whisper", side_effect=RuntimeError("no model")):
            with self.assertRaises(stt_service.TranscriptionError):
                stt_service.transcribe("x.webm")


# -------------------------------------------------------------
# Multi-criteria grading
# -------------------------------------------------------------
class CriteriaEvaluationTests(unittest.TestCase):
    def _evaluate(self, data):
        client = MagicMock()
        client.models.generate_content.return_value.text = json.dumps(data)
        with patch.object(gemini_service, "get_client", return_value=client):
            return gemini_service.evaluate_answer_with_rag("q", "an answer", ["private rubric point"], 0.6, 1)

    def test_answer_quality_is_weighted_mean_of_criteria(self):
        result = self._evaluate({"correctness": 80, "completeness": 60, "technical_depth": 70, "relevance": 100,
                                 "communication_score": 75, "strengths": ["Clear"], "improvements": [],
                                 "missing_concepts": [], "feedback": "Good."})
        self.assertEqual(result["evaluation_source"], "gemini")
        self.assertEqual(result["criteria_scores"]["completeness"], 60)
        # 0.35*80 + 0.25*60 + 0.25*70 + 0.15*100 = 75.5 -> 76 (round half even gives 76)
        self.assertEqual(result["answer_quality_score"], round(75.5))

    def test_partial_or_invalid_criteria_fall_back(self):
        base = {"communication_score": 75, "strengths": [], "improvements": [], "missing_concepts": [], "feedback": "x"}
        for bad in ({**base, "correctness": 80}, {**base, "correctness": 80, "completeness": 60,
                                                  "technical_depth": 70, "relevance": 101}):
            result = self._evaluate(bad)
            self.assertEqual(result["evaluation_source"], "fallback")
            self.assertEqual(result["criteria_scores"], {"relevance": 60})

    def test_legacy_shape_without_criteria_is_still_accepted(self):
        result = self._evaluate({"answer_quality_score": 82, "communication_score": 70, "strengths": [],
                                 "improvements": [], "missing_concepts": [], "feedback": "ok"})
        self.assertEqual(result["answer_quality_score"], 82)
        self.assertIsNone(result["criteria_scores"])


# -------------------------------------------------------------
# Scoring v2
# -------------------------------------------------------------
class ScoringV2Tests(unittest.TestCase):
    def test_camera_blend_and_frame_threshold(self):
        self.assertEqual(scoring.camera_engagement({"eyeContact": 80, "facePresence": 100, "cameraFacing": 50}), 80)
        self.assertIsNone(scoring.camera_engagement({"eyeContact": 90, "framesAnalyzed": 5}))
        self.assertEqual(scoring.camera_engagement({"eyeContact": 90, "framesAnalyzed": 40}), 90)

    def test_sanitize_vision_keeps_known_fields_only(self):
        clean = scoring.sanitize_vision({"eyeContact": "120", "facePresence": 88.4, "evil": "<script>",
                                         "multipleFaceEvents": 2.7, "expressions": {"neutral": 70, "x": "bad"}})
        self.assertEqual(clean, {"eyeContact": 100, "facePresence": 88, "multipleFaceEvents": 2,
                                 "expressions": {"neutral": 70}})
        self.assertIsNone(scoring.sanitize_vision("nope"))

    def test_applied_weights_renormalise(self):
        weights = scoring.applied_weights(80, 70, None, 60)
        self.assertNotIn("camera_engagement", weights)
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=2)

    def test_insights_name_weakest_criterion_and_pace(self):
        strengths, improvements = scoring.insights(
            {"correctness": 85, "completeness": 55, "technical_depth": 70, "relevance": 90},
            {"words_per_minute": 190, "fillers_per_minute": 4.5, "delivery_score": 60},
            {"eyeContact": 80, "lowPresenceAnswers": 1},
        )
        self.assertTrue(any("Relevance" in s for s in strengths))
        self.assertTrue(any("Completeness" in i for i in improvements))
        self.assertTrue(any("190 words per minute" in i for i in improvements))
        self.assertTrue(any("out of frame" in i for i in improvements))

    def test_vision_summary_flags(self):
        summary = scoring.summarize_vision([{"eyeContact": 80, "facePresence": 50, "multipleFaceEvents": 1},
                                            {"eyeContact": 60, "facePresence": 90}, None])
        self.assertEqual(summary["answers_with_camera"], 2)
        self.assertEqual(summary["eyeContact"], 70)
        self.assertEqual(summary["lowPresenceAnswers"], 1)
        self.assertEqual(summary["multipleFaceEvents"], 1)


# -------------------------------------------------------------
# /transcribe endpoint
# -------------------------------------------------------------
class TranscribeEndpointTests(unittest.TestCase):
    def _cursor(self, answered=False):
        return ScriptedCursor(one={
            "SELECT * FROM interviews": dict(INTERVIEW),
            "SELECT * FROM interview_questions": dict(QUESTION),
            "SELECT 1 FROM interview_responses": {"?column?": 1} if answered else None,
        })

    def test_transcribes_saves_audio_and_upserts_metrics(self):
        text = "Optimistic locking checks a version number at commit time and retries"
        result = {"text": text, "words": timed(text, step=0.45), "language": "en",
                  "duration_seconds": 6.0, "source": "whisper", "model": "base.en"}
        cursor = self._cursor()
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(main, "UPLOAD_DIR", folder), \
                patch.object(main.database, "get_db_connection", side_effect=lambda: FakeConnection(cursor)), \
                patch.object(main.stt_service, "transcribe", return_value=result) as transcribe:
            payload = main.transcribe_answer(INTERVIEW_ID, 1, upload(), user=USER)
            saved = os.path.join(folder, INTERVIEW_ID, "q_1_audio.webm")
            self.assertTrue(os.path.isfile(saved))
        transcribe.assert_called_once()
        self.assertEqual(payload["transcript"], text)
        self.assertEqual(payload["source"], "whisper")
        self.assertIsNotNone(payload["speech_metrics"]["delivery_score"])
        upsert = next(c for c in cursor.calls if c[0].startswith("INSERT INTO answer_transcripts"))
        self.assertIn("ON CONFLICT (interview_id, question_index) DO UPDATE", upsert[0])
        self.assertEqual(upsert[1][9], "q_1_audio.webm")

    def test_rejects_non_audio_answered_turn_and_silence(self):
        with self.assertRaises(HTTPException) as ctx:
            main.transcribe_answer(INTERVIEW_ID, 1, upload(content_type="text/plain"), user=USER)
        self.assertEqual(ctx.exception.status_code, 415)

        cursor = self._cursor(answered=True)
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            with self.assertRaises(HTTPException) as ctx:
                main.transcribe_answer(INTERVIEW_ID, 1, upload(), user=USER)
        self.assertEqual(ctx.exception.status_code, 409)

        cursor = self._cursor()
        silent = {"text": "  ", "words": [], "language": "en", "duration_seconds": 2, "source": "whisper", "model": "m"}
        with tempfile.TemporaryDirectory() as folder, patch.object(main, "UPLOAD_DIR", folder), \
                patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)), \
                patch.object(main.stt_service, "transcribe", return_value=silent):
            with self.assertRaises(HTTPException) as ctx:
                main.transcribe_answer(INTERVIEW_ID, 1, upload(), user=USER)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_transcription_failure_is_a_clear_422(self):
        cursor = self._cursor()
        with tempfile.TemporaryDirectory() as folder, patch.object(main, "UPLOAD_DIR", folder), \
                patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)), \
                patch.object(main.stt_service, "transcribe",
                             side_effect=stt_service.TranscriptionError("Could not transcribe.")):
            with self.assertRaises(HTTPException) as ctx:
                main.transcribe_answer(INTERVIEW_ID, 1, upload(), user=USER)
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (422, "Could not transcribe."))


# -------------------------------------------------------------
# Media and state endpoints
# -------------------------------------------------------------
class MediaAndStateTests(unittest.TestCase):
    def test_media_serves_owned_file_and_rejects_bad_paths(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(main, "UPLOAD_DIR", folder):
            os.makedirs(os.path.join(folder, INTERVIEW_ID))
            with open(os.path.join(folder, INTERVIEW_ID, "q_1.webm"), "wb") as handle:
                handle.write(b"video")
            for stored, expect in (("/uploads/x/q_1.webm", 200), ("../../etc/passwd", 404), (None, 404)):
                cursor = ScriptedCursor(one={
                    "SELECT * FROM interviews": dict(INTERVIEW),
                    "SELECT video_url, audio_path": {"video_url": stored, "audio_path": None},
                })
                with self.subTest(stored=stored), \
                        patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
                    if expect == 200:
                        response = main.get_answer_media(INTERVIEW_ID, 1, "video", user=USER)
                        self.assertEqual(response.media_type, "video/webm")
                    else:
                        with self.assertRaises(HTTPException) as ctx:
                            main.get_answer_media(INTERVIEW_ID, 1, "video", user=USER)
                        self.assertEqual(ctx.exception.status_code, 404)

    def _state(self, responses, turn=2):
        cursor = ScriptedCursor(
            one={"SELECT * FROM interviews": {**INTERVIEW, "current_turn": turn},
                 "SELECT * FROM interview_questions": {**QUESTION, "question_index": turn}},
            many={"FROM interview_responses": responses},
        )
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            return main.get_interview_state(INTERVIEW_ID, user=USER)

    def _row(self, index, advanced):
        return {"id": f"r{index}", "question_index": index, "question_text": "Q", "difficulty": "medium",
                "is_follow_up": False, "topic": "T", "candidate_answer": "A", "answer_quality_score": 80,
                "communication_score": 70, "criteria_scores": None, "strengths": [], "improvements": [],
                "feedback": "f", "missing_concepts": [], "evaluation_source": "gemini",
                "next_result": {"adaptation": {"reason": "keep"}} if advanced else None}

    def test_state_reports_current_question_and_pending_answer(self):
        state = self._state([self._row(1, True)])
        self.assertEqual(state["question"]["index"], 2)
        self.assertNotIn("rubric_points", state["question"])
        self.assertEqual(len(state["answered"]), 1)
        self.assertIsNone(state["pending_response_id"])
        self.assertFalse(state["awaiting_completion"])

        pending = self._state([self._row(1, True), self._row(2, False)])
        self.assertEqual(pending["pending_response_id"], "r2")

        done = self._state([self._row(1, True), self._row(2, True)])
        self.assertTrue(done["awaiting_completion"])


if __name__ == "__main__":
    unittest.main()
