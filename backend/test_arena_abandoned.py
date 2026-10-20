"""Real PostgreSQL tests: ranked Arena games closed on the server.

Set ARENA_TEST_DATABASE_URL (or COUNTER_CHEATING_TEST_DATABASE_URL) to a
disposable PostgreSQL database; skipped otherwise.
"""
import os
import uuid
from pathlib import Path

import psycopg2
import pytest
from fastapi.testclient import TestClient
from psycopg2.extras import RealDictCursor

import auth
import config
import gemini_service
import main

DSN = os.getenv("ARENA_TEST_DATABASE_URL") or os.getenv("COUNTER_CHEATING_TEST_DATABASE_URL")
pytestmark = [pytest.mark.real_auth, pytest.mark.skipif(not DSN, reason="Disposable PostgreSQL test DB not configured")]


@pytest.fixture
def client(monkeypatch):
    def connection():
        return psycopg2.connect(DSN, cursor_factory=RealDictCursor)

    with connection() as conn, conn.cursor() as cur:
        cur.execute((Path(__file__).parents[1] / "schema.sql").read_text())
    monkeypatch.setattr(main.database, "get_db_connection", connection)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")   # offline questions, no API calls
    user = auth.AuthUser(uid="arena-test-" + str(uuid.uuid4()), name="Arena Tester")
    main.app.dependency_overrides[auth.current_user] = lambda: user
    evaluation = dict(answer_quality_score=20, communication_score=30, strengths=[], improvements=[],
                      missing_concepts=[], feedback="Weak.", evaluation_source="gemini")
    monkeypatch.setattr(gemini_service, "get_embedding", lambda *_: [])
    monkeypatch.setattr(gemini_service, "get_embeddings", lambda points: [[] for _ in points])
    monkeypatch.setattr(gemini_service, "evaluate_answer_with_rag", lambda *a, **k: evaluation)
    try:
        yield TestClient(main.app), connection
    finally:
        main.app.dependency_overrides.pop(auth.current_user, None)
        with connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE firebase_uid=%s;", (user.uid,))


def start_game(client):
    result = client.post("/api/interviews/start", json={
        "role_title": "Backend Engineer", "interview_mode": "game", "coding_round": False,
        "arena_category": "backend", "job_description": "Practice backend questions."})
    assert result.status_code == 200, result.text
    return result.json()["interview_id"], result.json()["question"]


def answer_level(client, iid, question):
    saved = client.post(f"/api/interviews/{iid}/submit-answer", data={
        "question_index": question["index"], "question_text": question["question"],
        "candidate_answer": "An index speeds up reads at the cost of slower writes and extra storage."})
    assert saved.status_code == 200, saved.text
    advanced = client.post(f"/api/interviews/{iid}/next-question", json={"response_id": saved.json()["response_id"]})
    assert advanced.status_code == 200, advanced.text


def game(connection, iid):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, end_reason, ended_early FROM interviews WHERE id=%s;", (iid,))
        row = cur.fetchone()
        cur.execute("SELECT change FROM rating_events WHERE interview_id=%s;", (iid,))
        return row, [r["change"] for r in cur.fetchall()]


def test_starting_again_rates_the_game_left_behind(client):
    api, connection = client
    first, question = start_game(api)
    answer_level(api, first, question)            # played level 1 badly, then reloaded
    second, _ = start_game(api)
    row, changes = game(connection, first)
    assert (row["status"], row["end_reason"], row["ended_early"]) == ("completed", "away", True)
    assert changes and all(change < 0 for change in changes)
    assert game(connection, second)[0]["status"] == "in_progress"
    # The rated game now has results instead of "finish the Arena".
    assert api.get(f"/api/interviews/{first}/arena-results").status_code == 200


def test_a_game_left_before_any_answer_is_closed_without_a_rating_change(client):
    api, connection = client
    untouched, _ = start_game(api)
    start_game(api)
    row, changes = game(connection, untouched)
    assert (row["status"], row["end_reason"]) == ("abandoned", "away")
    assert changes == []


def test_idle_games_close_when_results_or_ranking_are_opened(client):
    api, connection = client
    iid, question = start_game(api)
    answer_level(api, iid, question)
    # Still active: opening the ranking does not touch it.
    assert api.get("/api/arena/me").status_code == 200
    assert game(connection, iid)[0]["status"] == "in_progress"
    with connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE interviews SET created_at = NOW() - interval '2 hours' WHERE id=%s;", (iid,))
        cur.execute("UPDATE interview_responses SET created_at = NOW() - interval '2 hours' WHERE interview_id=%s;", (iid,))
    results = api.get(f"/api/interviews/{iid}/arena-results")
    assert results.status_code == 200, results.text
    row, changes = game(connection, iid)
    assert (row["status"], row["end_reason"]) == ("completed", "away")
    assert changes and all(change < 0 for change in changes)


def test_standard_interviews_are_never_touched(client):
    api, connection = client
    result = api.post("/api/interviews/start", json={"role_title": "Backend Engineer", "max_turns": 3,
                      "interview_mode": "standard", "answer_mode": "typed", "coding_round": False})
    standard = result.json()["interview_id"]
    start_game(api)
    start_game(api)
    assert game(connection, standard)[0]["status"] == "in_progress"
