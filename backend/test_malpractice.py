"""Malpractice rules: reading detection, per-answer penalties, verdict,
identity helpers, stricter grading, and the identity endpoints."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import gemini_service
import identity
import integrity
import main
import malpractice
from test_integrity import ACTIVE, INTERVIEW_ID, USER
from test_main import FakeConnection
from test_profile import ScriptedCursor


def words(text, wpm=150, pause_every=None):
    """Word timings for ``text`` at a steady pace (optionally with pauses)."""
    result, t, step = [], 0.0, 60 / wpm
    for i, word in enumerate(text.split()):
        if pause_every and i and i % pause_every == 0:
            t += 2.0
        result.append({"word": word, "start": round(t, 2), "end": round(t + step * 0.8, 2), "probability": 0.9})
        t += step
    return result


SCRIPTED = ("Firstly, a database index is a data structure that improves the speed of retrieval operations. "
            "Furthermore, it is important to note that indexes play a crucial role in query optimization. "
            "Moreover, a robust indexing strategy ensures seamless performance. In conclusion, indexes "
            "facilitate efficient access while additionally requiring careful maintenance and storage overhead.")
SPONTANEOUS = ("so um an index is, is like a lookup structure, I mean I used one when our orders page was slow, "
               "we added a b-tree index on customer id and uh the query went from two seconds to like thirty "
               "milliseconds, but writes got a bit slower so you know you don't index everything")


class ReadingAssessmentTests(unittest.TestCase):
    def speech(self, text, timed, fillers_per_minute, long_pauses=0):
        return {"word_count": len(timed), "speaking_seconds": timed[-1]["end"],
                "words_per_minute": round(len(timed) / (timed[-1]["end"] / 60)),
                "fillers_per_minute": fillers_per_minute, "long_pauses": long_pauses}

    def test_reading_needs_two_independent_families(self):
        timed = words(SCRIPTED, wpm=160)
        speech = self.speech(SCRIPTED, timed, 0)
        # Speech rhythm alone: at most "medium", never a penalty.
        only_speech = malpractice.reading_assessment(timed, SCRIPTED, speech, None, None)
        self.assertNotEqual(only_speech["level"], "high")
        # Speech + gaze sweeps + content style: high.
        signals = {"gaze": {"speaking_ms": 30000, "sweeps": 5, "offscreen_ms": 2000}}
        content = {"scripted_likelihood": 85, "scripted_signals": ["essay-like structure"]}
        high = malpractice.reading_assessment(timed, SCRIPTED, speech, signals, content)
        self.assertEqual(high["level"], "high")
        self.assertGreaterEqual(len(high["families"]), 2)
        self.assertTrue(any("line sweeps" in e for e in high["evidence"]))

    def test_spontaneous_answer_is_low(self):
        timed = words(SPONTANEOUS, wpm=120, pause_every=12)
        speech = self.speech(SPONTANEOUS, timed, 4.5, long_pauses=3)
        result = malpractice.reading_assessment(timed, SPONTANEOUS, speech,
                                                {"gaze": {"speaking_ms": 30000, "sweeps": 0, "offscreen_ms": 1000}},
                                                {"scripted_likelihood": 10})
        self.assertEqual(result["level"], "low")

    def test_ai_phrases_and_repetitions(self):
        self.assertGreaterEqual(malpractice.ai_phrase_count(SCRIPTED), 6)
        self.assertEqual(malpractice.repetition_count(words("I I think the the answer")), 2)


class AnswerAssessmentTests(unittest.TestCase):
    LOW = {"level": "low", "score": 0, "families": [], "evidence": []}

    def assess(self, **kwargs):
        defaults = dict(voice_check=None, face_mismatch=False, events=[], signals=None, reading=self.LOW)
        return malpractice.assess_answer(**{**defaults, **kwargs})

    def test_another_person_answering_scores_zero(self):
        self.assertEqual(self.assess(voice_check={"verdict": "mismatch", "similarity": 0.05})["action"], "zero")
        self.assertEqual(self.assess(face_mismatch=True)["action"], "zero")

    def test_assistance_caps_the_answer(self):
        mixed = {"verdict": "mixed", "similarity": 0.4, "other_voice_segments": [{"start": 12, "end": 16}]}
        for kwargs in ({"voice_check": mixed}, {"events": ["phone_detected"]}, {"events": ["extra_person"]},
                       {"signals": {"typing": {"largest_insert": 120}}},
                       {"signals": {"lip_sync": {"voiced_ms": 9000, "voiced_mouth_still_ms": 6000}}},
                       {"reading": {**self.LOW, "level": "high", "evidence": ["x"]}}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.assess(**kwargs)["action"], "cap")

    def test_weak_signals_are_review_only(self):
        result = self.assess(voice_check={"verdict": "uncertain", "similarity": 0.2},
                             reading={**self.LOW, "level": "medium", "evidence": ["x"]})
        self.assertIsNone(result["action"])
        self.assertEqual({f["severity"] for f in result["flags"]}, {"review"})

    def test_penalty_applies_to_scores_and_criteria(self):
        evaluation = {"answer_quality_score": 88, "communication_score": 75,
                      "criteria_scores": {"correctness": 90, "relevance": 30}}
        capped = malpractice.apply_penalty(evaluation, {"action": "cap"})
        self.assertEqual((capped["answer_quality_score"], capped["communication_score"]), (40, 40))
        self.assertEqual(capped["criteria_scores"], {"correctness": 40, "relevance": 30})
        zeroed = malpractice.apply_penalty(evaluation, {"action": "zero"})
        self.assertEqual(zeroed["answer_quality_score"], 0)
        self.assertEqual(malpractice.apply_penalty(evaluation, {"action": None}), evaluation)

    def test_typing_injection(self):
        self.assertTrue(malpractice.typing_injected({"untrusted_inputs": 1}))
        self.assertTrue(malpractice.typing_injected({"chars": 400, "keystrokes": 40}))
        self.assertFalse(malpractice.typing_injected({"chars": 400, "keystrokes": 430, "largest_insert": 3}))

    def test_signals_are_sanitised(self):
        clean = malpractice.sanitize_signals({"latency_seconds": -5, "gaze": {"sweeps": float("nan"), "speaking_ms": 1e12},
                                              "typing": {"chars": True}, "evil": {"x": 1}})
        self.assertEqual(clean, {"latency_seconds": 0.0, "gaze": {"speaking_ms": 86400000}})
        self.assertIsNone(malpractice.sanitize_signals("nope"))


class VerdictTests(unittest.TestCase):
    def flags(self, code, severity, action):
        return {"flags": [{"code": code, "severity": severity}], "action": action}

    def test_clean_review_invalid(self):
        clean = {"flags": [], "action": None}
        self.assertEqual(malpractice.verdict([clean] * 5, 0, "clean", 5)["verdict"], "clean")
        capped = self.flags("reading", "cap", "cap")
        self.assertEqual(malpractice.verdict([capped] + [clean] * 4, 0, "minor", 5)["verdict"], "review")
        voice = self.flags("voice_mismatch", "zero", "zero")
        self.assertEqual(malpractice.verdict([voice, voice] + [clean] * 3, 0, "flagged", 5)["verdict"], "invalid")
        self.assertEqual(malpractice.verdict([clean] * 5, 2, "flagged", 5)["verdict"], "invalid")
        self.assertEqual(malpractice.verdict([voice] + [clean] * 4, 1, "flagged", 5)["verdict"], "invalid")
        self.assertEqual(malpractice.verdict([voice] + [clean] * 4, 0, "flagged", 5)["verdict"], "review")


class IdentityHelperTests(unittest.TestCase):
    def test_verdict_bands_and_gallery(self):
        self.assertEqual(identity.verdict(0.8, identity.FACE_MATCH, identity.FACE_MISMATCH), "match")
        self.assertEqual(identity.verdict(0.35, identity.FACE_MATCH, identity.FACE_MISMATCH), "uncertain")
        self.assertEqual(identity.verdict(0.1, identity.FACE_MATCH, identity.FACE_MISMATCH), "mismatch")
        self.assertEqual(identity.verdict(None, 0.5, 0.2), "unavailable")
        gallery = [[1.0, 0.0]]
        self.assertEqual(len(identity.grow_gallery(gallery, [0.9, 0.1], 0.9)), 2)
        self.assertEqual(len(identity.grow_gallery(gallery, [0.0, 1.0], 0.1)), 1)
        self.assertAlmostEqual(identity.best_similarity([1, 0], [[0, 1], [1, 0]]), 1.0)

    def test_speech_windows_group_words(self):
        timed = [{"word": "w", "start": i * 0.5, "end": i * 0.5 + 0.45} for i in range(40)]
        windows = identity.speech_windows(timed)
        self.assertGreaterEqual(len(windows), 3)
        self.assertTrue(all(end > start for start, end in windows))


class StrictGradingTests(unittest.TestCase):
    def test_short_irrelevant_and_incorrect_answers_are_capped(self):
        base = {"answer_quality_score": 80, "criteria_scores": {"correctness": 80, "relevance": 80}}
        self.assertEqual(gemini_service.apply_strictness(dict(base), "too short")["answer_quality_score"], 15)
        self.assertEqual(gemini_service.apply_strictness(dict(base), "word " * 12)["answer_quality_score"], 40)
        long = "word " * 30
        off_topic = {**base, "criteria_scores": {"correctness": 80, "relevance": 25}}
        self.assertEqual(gemini_service.apply_strictness(off_topic, long)["answer_quality_score"], 25)
        wrong = {**base, "criteria_scores": {"correctness": 20, "relevance": 90}}
        self.assertEqual(gemini_service.apply_strictness(wrong, long)["answer_quality_score"], 35)
        self.assertEqual(gemini_service.apply_strictness(dict(base), long)["answer_quality_score"], 80)


class IdentityEndpointTests(unittest.TestCase):
    def _snapshot(self, check, previous=None, profile=None):
        cursor = ScriptedCursor(
            one={"SELECT * FROM interviews": dict(ACTIVE),
                 "SELECT face_embeddings FROM identity_profiles": profile or {"face_embeddings": [[1.0, 0.0]]},
                 "SELECT verdict, details FROM identity_checks": previous},
            many={"SELECT event_type, duration_seconds": []},
        )

        class Upload:
            content_type = "image/jpeg"

            class file:
                @staticmethod
                def read(_n):
                    return b"jpeg"

        main._snapshot_times.clear()
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)), \
                patch.object(identity, "enabled", return_value=True), \
                patch.object(identity, "decode_image", return_value=object()), \
                patch.object(identity, "check_face", return_value=dict(check)), \
                patch.object(identity, "save_jpeg"):
            return main.identity_snapshot(INTERVIEW_ID, Upload(), 2, 1, 30.0, user=USER), cursor

    def test_one_mismatch_is_not_yet_an_event(self):
        result, cursor = self._snapshot({"verdict": "mismatch", "similarity": 0.1, "faces": 1})
        self.assertIsNone(result["event"])
        self.assertFalse(any("INSERT INTO proctoring_events" in q for q, _ in cursor.calls))

    def test_second_mismatch_in_a_row_is_a_confirmed_event(self):
        result, cursor = self._snapshot({"verdict": "mismatch", "similarity": 0.1, "faces": 1},
                                        previous={"verdict": "mismatch", "details": {"streak": 1}})
        self.assertEqual(result["event"]["type"], "face_mismatch")
        insert = next(p for q, p in cursor.calls if "INSERT INTO proctoring_events" in q)
        self.assertEqual(insert[2], "face_mismatch")
        # Evidence image is kept for mismatches only.
        check = next(p for q, p in cursor.calls if "INSERT INTO identity_checks" in q)
        self.assertTrue(check[8].startswith("check_"))

    def test_match_keeps_no_image(self):
        result, cursor = self._snapshot({"verdict": "match", "similarity": 0.8, "faces": 1, "embedding": [1, 0]})
        self.assertIsNone(result["event"])
        check = next(p for q, p in cursor.calls if "INSERT INTO identity_checks" in q)
        self.assertIsNone(check[8])

    def test_not_enrolled_is_unavailable(self):
        result, _ = self._snapshot({"verdict": "match"}, profile={"face_embeddings": []})
        self.assertEqual(result["verdict"], "unavailable")

    def test_browser_cannot_send_server_events(self):
        self.assertNotIn("face_mismatch", integrity.CLIENT_EVENT_TYPES)
        self.assertIn("extra_person", integrity.CLIENT_EVENT_TYPES)
        self.assertIn("phone_detected", integrity.MAJOR_EVENTS)

    def test_voice_check_raises_event_for_another_voice(self):
        cursor = ScriptedCursor(one={}, many={"SELECT event_type, duration_seconds": [{"event_type": "voice_mismatch"}]})
        result = main._store_voice_check(cursor, INTERVIEW_ID, 3, {"verdict": "mismatch", "similarity": 0.05,
                                                                     "embedding": [0.1]})
        self.assertEqual(result["event"]["type"], "voice_mismatch")
        self.assertEqual(result["violations"], 1)
        with self.assertRaises(HTTPException):
            main._read_image(type("U", (), {"content_type": "text/plain"})())


class CompletionIntegrityTests(unittest.TestCase):
    def _complete(self, voice_verdicts):
        answered = [{"id": f"r{i}", "question_id": f"q{i}", "question_index": i, "question_text": "Q",
                     "candidate_answer": "word " * 30, "answer_quality_score": 80, "communication_score": 80,
                     "evaluated_at": "now", "criteria_scores": None, "strengths": [], "improvements": []}
                    for i in range(1, 6)]
        checks = [{"kind": "voice", "question_index": i, "verdict": v, "similarity": 0.05,
                   "details": {"verdict": v, "similarity": 0.05}} for i, v in voice_verdicts.items()]
        cursor = ScriptedCursor(
            one={"SELECT * FROM interviews": dict(ACTIVE), "SELECT 1 FROM identity_profiles": {"?column?": 1},
                 "INSERT INTO evaluation_reports": {"id": "rep"}},
            many={"FROM interview_responses": answered, "FROM identity_checks": checks},
        )
        with patch.object(main.database, "get_db_connection", return_value=FakeConnection(cursor)),                 patch.object(main.gemini_service, "summarize_interview", return_value=None):
            return main.complete_and_evaluate_interview(INTERVIEW_ID, main.EvaluateInterviewRequest(), user=USER), cursor

    def test_two_answers_in_another_voice_invalidate_the_interview(self):
        result, cursor = self._complete({1: "mismatch", 2: "mismatch"})
        self.assertEqual(result["integrity"]["verdict"], "invalid")
        self.assertEqual(result["overall_score"], 0)
        self.assertGreater(result["integrity"]["score_before_integrity"], 0)
        self.assertTrue(result["feedback"].startswith("This interview is invalid"))
        stored = [p for q, p in cursor.calls if q.startswith("UPDATE interview_responses SET integrity")]
        self.assertEqual(len(stored), 5)

    def test_one_answer_in_another_voice_is_zeroed_and_reviewed(self):
        result, _ = self._complete({1: "mismatch"})
        self.assertEqual(result["integrity"]["verdict"], "review")
        self.assertEqual(result["scores"][0], {"label": "Answer Quality", "value": 64})  # (0 + 4*80) / 5
        self.assertGreater(result["overall_score"], 0)


if __name__ == "__main__":
    unittest.main()
