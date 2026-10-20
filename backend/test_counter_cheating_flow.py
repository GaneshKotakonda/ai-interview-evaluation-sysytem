"""Real PostgreSQL acceptance tests. Set COUNTER_CHEATING_TEST_DATABASE_URL.

This URL must point to a disposable test database, never the application's DB.
"""
import json
import os
from pathlib import Path
from unittest.mock import patch
import uuid

from fastapi.testclient import TestClient
import psycopg2
from psycopg2.extras import RealDictCursor
import pytest

import adaptive_service
import auth
import gemini_service
import main


DSN = os.getenv("COUNTER_CHEATING_TEST_DATABASE_URL")
pytestmark = [pytest.mark.real_auth, pytest.mark.skipif(not DSN, reason="Disposable PostgreSQL acceptance DB not configured")]


@pytest.fixture
def client(monkeypatch):
    def connection():
        return psycopg2.connect(DSN, cursor_factory=RealDictCursor)

    # Apply the actual additive schema twice: also proves migration rerunnability.
    with connection() as conn, conn.cursor() as cur:
        schema = (Path(__file__).parents[1] / "schema.sql").read_text()
        cur.execute(schema)
        cur.execute(schema)
    monkeypatch.setattr(main.database, "get_db_connection", connection)
    user = auth.AuthUser(uid="counter-test-" + str(uuid.uuid4()))
    main.app.dependency_overrides[auth.current_user] = lambda: user
    evaluation = dict(answer_quality_score=82, communication_score=80,
                      strengths=["Search interval is halved"], improvements=[], missing_concepts=[],
                      feedback="Explains complexity with a concrete search trace.", evaluation_source="gemini")
    monkeypatch.setattr(gemini_service, "get_embedding", lambda *_: [])
    monkeypatch.setattr(gemini_service, "get_embeddings", lambda points: [[] for _ in points])
    monkeypatch.setattr(gemini_service, "evaluate_answer_with_rag", lambda *a, **k: evaluation)
    monkeypatch.setattr(gemini_service, "summarize_interview", lambda *a, **k: None)
    try:
        yield TestClient(main.app), connection, user
    finally:
        main.app.dependency_overrides.pop(auth.current_user, None)
        with connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE firebase_uid=%s;", (user.uid,))


def answer(client, iid, index, end=30, observation_start=None):
    result = client.post(f"/api/interviews/{iid}/submit-answer", data={
        "question_index": index, "candidate_answer": "Binary search halves the sorted search interval on each comparison. The ordering lets us discard the half that cannot contain the target.",
        "recording_part": 1, "answer_start_seconds": 10, "answer_end_seconds": end,
        **({"observation_start_seconds": observation_start} if observation_start is not None else {}),
    })
    assert result.status_code == 200, result.text
    return result.json()["response_id"]


def start(client, max_turns=5, coding_round=False):
    result = client.post("/api/interviews/start", json={"role_title": "Backend Engineer", "max_turns": max_turns,
                         "interview_mode": "standard", "answer_mode": "typed", "coding_round": coding_round})
    assert result.status_code == 200, result.text
    return result.json()["interview_id"]


def advance(client, iid, rid):
    result = client.post(f"/api/interviews/{iid}/next-question", json={"response_id": rid})
    assert result.status_code == 200, result.text
    return result.json()


def test_stored_phone_episode_to_targeted_challenge_grade_and_complete_report(client):
    browser, connection, _ = client
    iid = start(browser)
    first = advance(browser, iid, answer(browser, iid, 1))
    assert first["next_question"]["kind"] == "spoken"
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""UPDATE interview_questions SET question_text='Explain how binary search works.',
                       topic='Binary-search complexity', rubric_points=%s
                       WHERE interview_id=%s AND question_index=2;""",
                    (json.dumps(["Halving the sorted search interval", "Logarithmic worst-case complexity"]), iid))
    event = {"id": "confirmed-phone-q2", "type": "phone_detected", "question_index": 2, "part": 1, "at": 20,
             "details": {"source": "confirmed_scene_episode"}}
    assert browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [event, event]}).status_code == 200
    rid = answer(browser, iid, 2)
    result = advance(browser, iid, rid)
    question = result["next_question"]
    assert question["kind"] == "verify"
    assert question["index"] == 3
    assert question["question"] != "Explain how binary search works."
    assert "binary" in question["question"].lower() or "search" in question["question"].lower()
    assert "risk_score" not in json.dumps(result)
    assert "verification_meta" not in json.dumps(browser.get(f"/api/interviews/{iid}/state").json())
    assert advance(browser, iid, rid) == result
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT verification_meta FROM interview_questions WHERE interview_id=%s AND kind='verify';", (iid,))
        metadata = cur.fetchone()["verification_meta"]
        assert metadata["policy_version"] == "counter_cheating_v1"
        assert metadata["parent_response_id"] == rid
        assert "confirmed-phone-q2" in metadata["evidence_ids"]
        cur.execute("SELECT COUNT(*) n FROM proctoring_events WHERE interview_id=%s;", (iid,))
        assert cur.fetchone()["n"] == 1
    verification_rid = answer(browser, iid, 3)
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT verification_result FROM interview_responses WHERE id=%s;", (verification_rid,))
        saved = cur.fetchone()["verification_result"]
        assert saved["status"] == "passed"
        assert saved["score"] == 82
        assert saved["parent_question_index"] == 2
    following = advance(browser, iid, verification_rid)
    assert following["next_question"]["kind"] == "spoken"
    advance(browser, iid, answer(browser, iid, 4))
    final = advance(browser, iid, answer(browser, iid, 5))
    assert final["is_complete"] and final["current_turn"] == 5
    completed = browser.post(f"/api/interviews/{iid}/complete", json={})
    assert completed.status_code == 200, completed.text
    report = browser.get(f"/api/interviews/{iid}/report").json()
    assert completed.json()["verification"] == report["verification"] == {"challenges": 1, "passed": 1, "partial": 0, "failed": 0}
    challenge = report["integrity"]["verification"]["details"][0]
    assert challenge["question_index"] == 3 and challenge["parent_question_index"] == 2
    assert challenge["evidence"][0]["event_type"] == "phone_detected"
    assert challenge["verification_target"] and challenge["result"]["status"] == "passed"
    assert challenge["result"]["score"] == 82
    assert {"verification_requested", "verification_result"} <= {e["type"] for e in report["integrity"]["verification"]["timeline"]}
    assert browser.post(f"/api/interviews/{iid}/complete", json={}).json() == completed.json()


@pytest.mark.parametrize("event_index,event_at", [(2, 31), (1, 20), (None, 20)])
def test_late_or_wrong_answer_phone_never_challenges_prior_response(client, event_index, event_at):
    browser, _, _ = client
    iid = start(browser)
    advance(browser, iid, answer(browser, iid, 1))
    rid = answer(browser, iid, 2)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "late-phone", "type": "phone_detected", "question_index": event_index, "part": 1, "at": event_at}]})
    assert advance(browser, iid, rid)["next_question"]["kind"] == "spoken"


def test_challenge_issuance_rolls_back_and_retry_creates_only_one(client):
    browser, connection, _ = client
    iid = start(browser)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "rollback-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    rid = answer(browser, iid, 1)
    original = adaptive_service.store_question

    def fail_after_insert(*args):
        original(*args)
        raise RuntimeError("simulated interrupted question storage")

    with patch.object(adaptive_service, "store_question", side_effect=fail_after_insert):
        result = browser.post(f"/api/interviews/{iid}/next-question", json={"response_id": rid})
    assert result.status_code == 500
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM interview_questions WHERE interview_id=%s AND kind='verify';", (iid,))
        assert cur.fetchone()["n"] == 0
    result = advance(browser, iid, rid)
    assert result["next_question"]["kind"] == "verify"
    assert advance(browser, iid, rid) == result


def test_delayed_pre_submission_phone_delivery_still_issues_verification(client):
    browser, _, _ = client
    iid = start(browser)
    rid = answer(browser, iid, 1)
    # Transport happens after grading, but the recorded observation belongs
    # to the immutable answer window, not to processing time.
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "delayed-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    assert advance(browser, iid, rid)["next_question"]["kind"] == "verify"


def test_untimed_post_submission_phone_is_retained_without_challenging(client):
    browser, connection, _ = client
    iid = start(browser)
    rid = answer(browser, iid, 1)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "processing-phone", "type": "phone_detected", "question_index": 1}]})
    assert advance(browser, iid, rid)["next_question"]["kind"] == "spoken"
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM proctoring_events WHERE interview_id=%s;", (iid,))
        assert cur.fetchone()["n"] == 1


def test_final_turn_records_versioned_suppression_without_extra_question(client):
    browser, connection, _ = client
    iid = start(browser, max_turns=1)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "final-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    rid = answer(browser, iid, 1)
    result = advance(browser, iid, rid)
    assert result["is_complete"] and result["current_turn"] == 1 and result["next_question"] is None
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT integrity FROM interview_responses WHERE id=%s;", (rid,))
        decision = cur.fetchone()["integrity"]["counter_cheating"]
        assert decision["policy_version"] == "counter_cheating_v1"
        assert decision["suppression_reason"] == "final_turn"
        assert not decision["trigger_verification"]


def test_arena_delayed_events_preserve_existing_assistance_penalty(client):
    browser, connection, _ = client
    started = browser.post("/api/interviews/start", json={"role_title": "Backend Engineer", "max_turns": 6,
                           "interview_mode": "game", "coding_round": False})
    assert started.status_code == 200, started.text
    iid = started.json()["interview_id"]
    saved = browser.post(f"/api/interviews/{iid}/submit-answer", data={"question_index": 1,
                          "candidate_answer": "Stateless requests use resource representations and standard HTTP methods."})
    assert saved.status_code == 200, saved.text
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "arena-delayed-phone", "type": "phone_detected", "question_index": 1}]})
    ended = browser.post(f"/api/interviews/{iid}/arena-end", json={"reason": "violations"})
    assert ended.status_code == 200, ended.text
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT integrity FROM interview_responses WHERE interview_id=%s;", (iid,))
        assert cur.fetchone()["integrity"]["adjusted_score"] == 40


def test_phone_confirmed_during_question_preparation_remains_eligible(client):
    browser, _, _ = client
    iid = start(browser)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "preparation-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 7}]})
    rid = answer(browser, iid, 1, observation_start=5)
    assert advance(browser, iid, rid)["next_question"]["kind"] == "verify"


def test_feature_disabled_preserves_ordinary_progression_and_stored_evidence(client, monkeypatch):
    browser, connection, _ = client
    monkeypatch.setattr(adaptive_service.config, "COUNTER_CHEATING_ENABLED", False)
    iid = start(browser)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "disabled-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    assert advance(browser, iid, answer(browser, iid, 1))["next_question"]["kind"] == "spoken"
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM proctoring_events WHERE interview_id=%s;", (iid,))
        assert cur.fetchone()["n"] == 1
        cur.execute("SELECT COUNT(*) n FROM interview_questions WHERE interview_id=%s AND kind='verify';", (iid,))
        assert cur.fetchone()["n"] == 0


def test_verification_takes_coding_turn_and_coding_moves_to_next_turn(client, monkeypatch):
    browser, connection, _ = client
    iid = start(browser, coding_round=True)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "coding-slot-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    rid = answer(browser, iid, 1)
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM interview_responses WHERE id=%s;", (rid,))
        expected = adaptive_service.adaptation_for(cur.fetchone())["next_difficulty"]
    issued = advance(browser, iid, rid)
    assert issued["next_question"]["index"] == 2
    assert issued["next_question"]["kind"] == "verify"
    assert issued["next_question"]["difficulty"] == issued["adaptation"]["next_difficulty"] == expected
    # The coding question displaced from turn 2 moves to turn 3; turn 4 keeps
    # its own, so the interview still has both coding questions.
    moved = advance(browser, iid, answer(browser, iid, 2))["next_question"]
    assert moved["index"] == 3 and moved["kind"] == "coding"
    monkeypatch.setattr(main.code_runner, "run_tests", lambda *a, **k: {
        "compiled": True, "compile_output": "", "passed": 1, "total": 1,
        "results": [{"status": "passed", "time_ms": 1}]})
    monkeypatch.setattr(gemini_service, "review_code", lambda *a: None)
    submitted = browser.post(f"/api/interviews/{iid}/code/submit", json={
        "question_index": 3, "language": "python", "code": "print('solution')"})
    assert submitted.status_code == 200, submitted.text
    scheduled = advance(browser, iid, submitted.json()["response_id"])["next_question"]
    assert scheduled["index"] == 4 and scheduled["kind"] == "coding"


def test_coding_answer_challenge_uses_normal_submission_without_hidden_test_disclosure(client, monkeypatch):
    browser, connection, _ = client
    iid = start(browser, coding_round=True)
    assert advance(browser, iid, answer(browser, iid, 1))["next_question"]["kind"] == "coding"
    with connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE interview_questions SET coding_private=%s WHERE interview_id=%s AND question_index=2;",
                    (json.dumps({"source": "ai", "tests": [{"input": "HIDDEN_TEST_SENTINEL", "expected": "secret"}]}), iid))
    monkeypatch.setattr(main.code_runner, "run_tests", lambda *a, **k: {
        "compiled": True, "compile_output": "", "passed": 1, "total": 1,
        "results": [{"status": "passed", "time_ms": 1}]})
    monkeypatch.setattr(gemini_service, "review_code", lambda *a: None)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "code-phone", "type": "phone_detected", "question_index": 2, "part": 1, "at": 20}]})
    submitted = browser.post(f"/api/interviews/{iid}/code/submit", json={
        "question_index": 2, "language": "python", "code": "print('SUBMITTED_SOLUTION_SENTINEL')",
        "recording_part": 1, "answer_start_seconds": 10, "answer_end_seconds": 30,
        "observation_start_seconds": 5})
    assert submitted.status_code == 200, submitted.text
    question = advance(browser, iid, submitted.json()["response_id"])["next_question"]
    assert question["kind"] == "verify" and question["index"] == 3
    assert "submitted solution" in question["question"].lower()
    assert "HIDDEN_TEST_SENTINEL" not in json.dumps(question)
    assert "SUBMITTED_SOLUTION_SENTINEL" not in json.dumps(question)
    verified = answer(browser, iid, 3)
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT verification_result FROM interview_responses WHERE id=%s;", (verified,))
        assert cur.fetchone()["verification_result"]["score"] == 82


def test_early_completion_keeps_issued_unanswered_challenge_pending(client):
    browser, _, _ = client
    iid = start(browser, max_turns=2)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "last-slot-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    assert advance(browser, iid, answer(browser, iid, 1))["next_question"]["kind"] == "verify"
    completed = browser.post(f"/api/interviews/{iid}/complete", json={"ended_early": True})
    assert completed.status_code == 200, completed.text
    # An early final report includes issued questions without fabricating a result.
    pending = browser.get(f"/api/interviews/{iid}/report").json()
    assert pending["verification"] == {"challenges": 1, "passed": 0, "partial": 0, "failed": 0}
    assert pending["integrity"]["verification"]["details"][0]["result"] is None


def test_final_scheduled_verification_answer_keeps_result(client):
    browser, _, _ = client
    iid = start(browser, max_turns=2)
    browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
        "id": "last-slot-phone", "type": "phone_detected", "question_index": 1, "part": 1, "at": 20}]})
    assert advance(browser, iid, answer(browser, iid, 1))["next_question"]["kind"] == "verify"
    rid = answer(browser, iid, 2)
    result = advance(browser, iid, rid)
    assert result["is_complete"] and result["current_turn"] == 2
    completed = browser.post(f"/api/interviews/{iid}/complete", json={})
    assert completed.status_code == 200, completed.text
    assert completed.json()["verification"] == {"challenges": 1, "passed": 1, "partial": 0, "failed": 0}


def test_second_challenge_in_long_interview_does_not_repeat_older_verification(client):
    browser, _, _ = client
    iid = start(browser, max_turns=11)

    def phone(index):
        observed = browser.post(f"/api/interviews/{iid}/proctoring", json={"events": [{
            "id": f"long-phone-{index}", "type": "phone_detected", "question_index": index, "part": 1, "at": 20}]})
        assert observed.status_code == 200, observed.text

    phone(1)
    first = advance(browser, iid, answer(browser, iid, 1))["next_question"]
    assert first["kind"] == "verify" and first["index"] == 2
    for index in range(2, 9):
        assert advance(browser, iid, answer(browser, iid, index))["next_question"]["kind"] == "spoken"
    phone(9)
    second = advance(browser, iid, answer(browser, iid, 9))["next_question"]
    assert second["kind"] == "verify" and second["index"] == 10
    assert second["question"] != first["question"]
    assert advance(browser, iid, answer(browser, iid, 10))["next_question"]["kind"] == "spoken"
    assert advance(browser, iid, answer(browser, iid, 11))["is_complete"]
    completed = browser.post(f"/api/interviews/{iid}/complete", json={})
    assert completed.status_code == 200, completed.text
    assert completed.json()["verification"] == {"challenges": 2, "passed": 2, "partial": 0, "failed": 0}
