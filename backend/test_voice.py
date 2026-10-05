"""Voice interview: Piper speech, chunked session recording, recording
positions, Whisper hallucination filtering and the holistic summary."""
import json
import os
import tempfile
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import gemini_service
import main
import stt_service
import tts_service
from auth import AuthUser
from test_main import FakeConnection
from test_profile import ScriptedCursor

USER = AuthUser(uid="firebase-user-abc123", name="Shafreed Shaik")
INTERVIEW_ID = "22222222-2222-2222-2222-222222222222"
INTERVIEW = {"id": INTERVIEW_ID, "user_id": "u", "status": "in_progress", "current_turn": 2,
             "max_turns": 5, "role_title": "Backend Engineer", "interview_mode": "standard"}


def connection_for(one=None):
    return FakeConnection(ScriptedCursor(one={"SELECT * FROM interviews": dict(INTERVIEW), **(one or {})}))


def chunk(data=b"chunk", content_type="video/webm"):
    return UploadFile(file=BytesIO(data), filename="c.webm", headers=Headers({"content-type": content_type}))


# -------------------------------------------------------------
# Piper text-to-speech
# -------------------------------------------------------------
class TtsServiceTests(unittest.TestCase):
    def test_prepare_text_strips_markdown_and_limits_length(self):
        self.assertEqual(tts_service.prepare_text("Use `SELECT *`  **carefully**\n now"), "Use SELECT carefully now")
        self.assertEqual(len(tts_service.prepare_text("a " * 2000)), tts_service.MAX_TEXT_CHARS)

    def test_intro_and_question_wording(self):
        self.assertIn("Hello Shafreed.", tts_service.intro_text("Shafreed", "Backend Engineer", 5))
        self.assertIn("5 questions", tts_service.intro_text(None, "Backend Engineer", 5))
        self.assertEqual(tts_service.question_text(2, "Why?", True), "Question 2, a follow-up. Why?")

    def test_synthesis_is_cached_and_disabled_provider_raises(self):
        voice = MagicMock()
        voice.synthesize_wav.side_effect = lambda text, wav, syn_config=None: (
            wav.setnchannels(1), wav.setsampwidth(2), wav.setframerate(22050), wav.writeframes(b"\0\0" * 10))
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(tts_service.config, "TTS_PROVIDER", "piper"), \
                patch.object(tts_service.config, "TTS_CACHE_DIR", folder), \
                patch.object(tts_service, "_get_voice", return_value=voice):
            first = tts_service.synthesize("Hello there")
            second = tts_service.synthesize("Hello   there")  # same text after tidying
            self.assertEqual(first, second)
            self.assertTrue(os.path.isfile(first))
            self.assertEqual(voice.synthesize_wav.call_count, 1)
        with patch.object(tts_service.config, "TTS_PROVIDER", "off"):
            with self.assertRaises(tts_service.SpeechUnavailable):
                tts_service.synthesize("Hello")


class SpeechEndpointTests(unittest.TestCase):
    def _speak(self, item, one=None):
        with patch.object(main.database, "get_db_connection", return_value=connection_for(one)), \
                patch.object(main.tts_service, "synthesize", side_effect=lambda text: f"/tmp/{len(text)}.wav") as synth, \
                patch.object(main, "FileResponse", side_effect=lambda path, **kw: {"path": path, **kw}):
            response = main.interview_speech(INTERVIEW_ID, item, user=USER)
        return response, synth.call_args[0][0]

    def test_intro_uses_first_name_and_question_comes_from_database(self):
        _, text = self._speak("intro")
        self.assertTrue(text.startswith("Hello Shafreed."))
        response, text = self._speak("question-2", {"SELECT question_text, is_follow_up": {
            "question_text": "Explain idempotency.", "is_follow_up": False}})
        self.assertEqual(text, "Question 2. Explain idempotency.")
        self.assertEqual(response["media_type"], "audio/wav")

    def test_future_questions_and_unknown_items_are_refused(self):
        for item in ("question-3", "question-0", "anything", "question-x"):
            with self.subTest(item=item), self.assertRaises(HTTPException) as ctx:
                self._speak(item)
            self.assertEqual(ctx.exception.status_code, 404)

    def test_phrase_whitelist_and_unavailable_engine(self):
        with self.assertRaises(HTTPException) as ctx:
            main.speech_phrase("say-anything", user=USER)
        self.assertEqual(ctx.exception.status_code, 404)
        with patch.object(main.tts_service, "synthesize", side_effect=tts_service.SpeechUnavailable("off")):
            with self.assertRaises(HTTPException) as ctx:
                main.speech_phrase("speaker_test", user=USER)
        self.assertEqual(ctx.exception.status_code, 503)


# -------------------------------------------------------------
# Whole-interview recording (chunked)
# -------------------------------------------------------------
class SessionRecordingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        patcher = patch.object(main, "UPLOAD_DIR", self.folder.name)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _upload(self, part, seq, data=b"chunk", content_type="video/webm", interview=None):
        cursor = ScriptedCursor(one={"SELECT * FROM interviews": interview or dict(INTERVIEW)})
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)):
            return main.upload_recording_chunk(INTERVIEW_ID, part, seq, chunk(data, content_type), user=USER)

    def test_chunks_append_in_order_and_retries_are_idempotent(self):
        self.assertEqual(self._upload(1, 0, b"aa")["next_seq"], 1)
        self.assertEqual(self._upload(1, 1, b"bb")["next_seq"], 2)
        self.assertTrue(self._upload(1, 1, b"bb")["duplicate"])  # client retry
        with open(os.path.join(self.folder.name, INTERVIEW_ID, "session_1.webm"), "rb") as handle:
            self.assertEqual(handle.read(), b"aabb")
        self.assertEqual(main.recording_parts(INTERVIEW_ID), [1])

    def test_gaps_wrong_types_arena_and_size_limits_are_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            self._upload(1, 3)
        self.assertEqual(ctx.exception.status_code, 409)
        with self.assertRaises(HTTPException) as ctx:
            self._upload(1, 0, content_type="text/plain")
        self.assertEqual(ctx.exception.status_code, 415)
        with self.assertRaises(HTTPException) as ctx:
            self._upload(1, 0, interview={**INTERVIEW, "interview_mode": "game"})
        self.assertEqual(ctx.exception.status_code, 409)
        with patch.object(main.config, "MAX_SESSION_RECORDING_MB", 0):
            with self.assertRaises(HTTPException) as ctx:
                self._upload(2, 0)
        self.assertEqual(ctx.exception.status_code, 413)

    def test_parts_are_separate_files_and_playable_by_owner(self):
        self._upload(1, 0, b"first")
        self._upload(2, 0, b"second", content_type="video/mp4")
        self.assertEqual(main.recording_parts(INTERVIEW_ID), [1, 2])
        with patch.object(main.database, "get_db_connection", return_value=connection_for()):
            response = main.get_session_recording(INTERVIEW_ID, 2, user=USER)
        self.assertEqual(response.media_type, "video/mp4")
        with patch.object(main.database, "get_db_connection", return_value=connection_for()):
            with self.assertRaises(HTTPException) as ctx:
                main.get_session_recording(INTERVIEW_ID, 9, user=USER)
        self.assertEqual(ctx.exception.status_code, 404)


class RecordingPositionTests(unittest.TestCase):
    def test_valid_and_invalid_positions(self):
        self.assertEqual(main._recording_position(1, 12.345, 40), {"part": 1, "start": 12.35, "end": 40})
        for args in ((None, 1, 2), (1, 5, 2), (0, 1, 2), (1, -1, 2), ("1", 1, 2)):
            with self.subTest(args=args):
                self.assertIsNone(main._recording_position(*args))


# -------------------------------------------------------------
# Whisper hallucination filtering and context prompt
# -------------------------------------------------------------
def segment(text, start=0.0, end=2.0, no_speech=0.05, logprob=-0.2):
    return SimpleNamespace(text=text, start=start, end=end, no_speech_prob=no_speech, avg_logprob=logprob)


class WhisperFilterTests(unittest.TestCase):
    def test_trailing_thank_you_and_non_speech_are_dropped(self):
        self.assertFalse(stt_service._keep_segment(segment(" Thank you.", 10, 10.8), is_last=True))
        self.assertFalse(stt_service._keep_segment(segment("noise", no_speech=0.9, logprob=-1.5), is_last=False))
        self.assertTrue(stt_service._keep_segment(segment(" Thank you.", 10, 13, no_speech=0.01, logprob=-0.1),
                                                  is_last=False))
        self.assertTrue(stt_service._keep_segment(segment(" I would use a transaction."), is_last=True))

    def test_question_primes_the_prompt(self):
        prompt = stt_service._prompt_for("How do PostgreSQL transactions avoid partial writes?")
        self.assertTrue(prompt.startswith("How do PostgreSQL transactions"))
        self.assertIn("Umm", prompt)
        self.assertEqual(stt_service._prompt_for(None), stt_service._VERBATIM_PROMPT)


# -------------------------------------------------------------
# Holistic evaluation
# -------------------------------------------------------------
class HolisticSummaryTests(unittest.TestCase):
    TURNS = [{"question": "Q1", "answer": "A1", "answer_quality_score": 80, "criteria_scores": None, "topic": "T"}]

    def _summarize(self, data):
        client = MagicMock()
        client.models.generate_content.return_value.text = json.dumps(data)
        with patch.object(gemini_service, "get_client", return_value=client):
            return gemini_service.summarize_interview("Backend Engineer", "", self.TURNS)

    def test_valid_summary_is_trimmed_and_returned(self):
        result = self._summarize({"summary": "You explained clearly.", "strengths": ["Clear", " "],
                                  "improvements": ["Add metrics"]})
        self.assertEqual(result, {"summary": "You explained clearly.", "strengths": ["Clear"],
                                  "improvements": ["Add metrics"]})

    def test_invalid_output_or_no_key_returns_none(self):
        self.assertIsNone(self._summarize({"summary": "", "strengths": [], "improvements": []}))
        self.assertIsNone(self._summarize({"summary": "ok", "strengths": "bad"}))
        self.assertIsNone(gemini_service.summarize_interview("Role", "", self.TURNS))  # conftest: no key
        self.assertIsNone(gemini_service.summarize_interview("Role", "", []))


if __name__ == "__main__":
    unittest.main()


class BatchedEmbeddingTests(unittest.TestCase):
    def test_one_request_for_all_rubric_points(self):
        client = MagicMock()
        client.models.embed_content.return_value.embeddings = [
            SimpleNamespace(values=[0.1] * gemini_service.config.EMBEDDING_DIMENSIONS) for _ in range(3)]
        with patch.object(gemini_service, "get_client", return_value=client):
            vectors = gemini_service.get_embeddings(["a", "b", "c"])
        self.assertEqual(len(vectors), 3)
        self.assertEqual(client.models.embed_content.call_count, 1)

    def test_falls_back_to_one_by_one_and_never_raises(self):
        with patch.object(gemini_service, "get_client", side_effect=ValueError("no key")), \
                patch.object(gemini_service, "get_embedding", side_effect=[[0.5], RuntimeError("down")]):
            self.assertEqual(gemini_service.get_embeddings(["a", "b"]), [[0.5], []])
        self.assertEqual(gemini_service.get_embeddings([]), [])


class TtsWarmUpTests(unittest.TestCase):
    def test_warm_up_loads_the_voice_even_when_phrases_are_cached(self):
        voice = MagicMock()
        voice.synthesize_wav.side_effect = lambda text, wav, syn_config=None: (
            wav.setnchannels(1), wav.setsampwidth(2), wav.setframerate(22050), wav.writeframes(b"\0\0"))
        with patch.object(tts_service.config, "TTS_PROVIDER", "piper"), \
                patch.object(tts_service, "_get_voice", return_value=voice) as load, \
                patch.object(tts_service, "synthesize", return_value="/cached.wav"):
            self.assertTrue(tts_service.warm_up())
        load.assert_called_once()
        voice.synthesize_wav.assert_called_once()
