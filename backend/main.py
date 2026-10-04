"""FastAPI entry point for the AI Interview Evaluation System.

Run from the repository root:
    python -m uvicorn main:app --app-dir backend --reload --port 8000

Every endpoint except /health requires ``Authorization: Bearer <Firebase ID
token>`` (see auth.py). Interview endpoints only act on interviews owned by
the signed-in user; /users/{firebase_uid} paths must name that user.

Endpoints (all under /api):
    POST /interviews/start                  create a session + first question
    POST /interviews/{id}/submit-answer     save, embed and grade one answer
    POST /interviews/{id}/next-question     apply policy, issue the next turn
    POST /interviews/{id}/hint              Arena only: spend the one hint
    POST /interviews/{id}/complete          Standard only: build final report
    GET  /interviews/{id}/report            saved Standard report + turns
    GET  /interviews/{id}/arena-results     saved Arena summary
    GET  /interviews/user/{firebase_uid}    a user's interview history
    DELETE /interviews/{id}                 owner deletes one interview
    GET  /users/{firebase_uid}/profile      profile + practice statistics
    PUT  /users/{firebase_uid}/profile      create/update name and email
    GET  /users/{firebase_uid}/reports      saved Standard reports + scores
    GET  /health                            liveness + database check
"""
import json
import logging
import os
import shutil
import uuid
from contextlib import asynccontextmanager, contextmanager
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config  # loads backend/.env before the modules below read settings
import adaptive_service
import arena
import auth
from auth import AuthUser
import database
import gemini_service
import scoring

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("interview-api")


# -------------------------------------------------------------
# BLOCK 1: Application, lifespan and CORS
# -------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Check PostgreSQL once at startup; the API still starts if it is down."""
    logger.info("Server starting; checking PostgreSQL connection")
    database.test_db_connection()
    yield


app = FastAPI(
    title="AI Interview Evaluation API",
    description="Adaptive question generation, RAG answer evaluation, and media storage",
    version="1.1.0",
    lifespan=lifespan,
)

# The React dev server (http://localhost:5173) is a different origin from
# this API (http://localhost:8000), so the browser needs CORS headers.
# Origins come from CORS_ORIGINS; no cookies are used, so credentials are off.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------
# BLOCK 2: Answer-video storage
# -------------------------------------------------------------
# Videos are written to backend/uploads/<interview_id>/q_<n>.webm. They are
# deliberately NOT served over HTTP: a public static mount would expose every
# candidate's recording to anyone who could guess the URL.
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

UPLOAD_CHUNK_BYTES = 1024 * 1024


def save_answer_video(interview_id: str, question_index: int, video: UploadFile) -> str:
    """Stream an uploaded answer video to disk and return its storage path.

    Rejects files larger than MAX_UPLOAD_MB with HTTP 413 and removes the
    partial file. The canonical UUID is used for both the folder and the URL
    so they always match, whatever case the client sent.
    """
    canonical_id = str(uuid.UUID(interview_id))
    folder = os.path.join(UPLOAD_DIR, canonical_id)
    os.makedirs(folder, exist_ok=True)
    filename = f"q_{question_index}.webm"
    path = os.path.join(folder, filename)

    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    written = 0
    with open(path, "wb") as buffer:
        while chunk := video.file.read(UPLOAD_CHUNK_BYTES):
            written += len(chunk)
            if written > limit:
                break
            buffer.write(chunk)
    if written > limit:
        os.remove(path)
        raise HTTPException(413, f"Answer video exceeds the {config.MAX_UPLOAD_MB} MB limit.")
    return f"/uploads/{canonical_id}/{filename}"


# -------------------------------------------------------------
# BLOCK 3: Database transaction helper
# -------------------------------------------------------------
@contextmanager
def transaction(error_detail: str):
    """Yield ``(conn, cur)``; commit on success, roll back on any error.

    ``HTTPException`` passes through unchanged. Any other exception is
    logged with its traceback and replaced by HTTP 500 with ``error_detail``
    so internal details never reach the client. A database that cannot be
    reached at all is reported the same way.
    """
    try:
        conn = database.get_db_connection()
    except Exception:
        logger.exception("Database connection failed")
        raise HTTPException(status_code=500, detail=error_detail)
    try:
        with conn.cursor() as cur:
            yield conn, cur
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        logger.exception(error_detail)
        conn.rollback()
        raise HTTPException(status_code=500, detail=error_detail)
    finally:
        conn.close()


# -------------------------------------------------------------
# BLOCK 3b: Ownership check
# -------------------------------------------------------------
def authorize_interview(cur, interview, user: AuthUser):
    """404 unless ``interview`` belongs to the signed-in user.

    404 rather than 403 so a caller cannot probe which interview ids exist.
    """
    cur.execute("SELECT firebase_uid FROM users WHERE id = %s;", (interview.get("user_id"),))
    owner = cur.fetchone()
    if not owner or owner["firebase_uid"] != user.uid:
        raise HTTPException(status_code=404, detail="Interview not found.")


def owned_interview(cur, interview_id: str, user: AuthUser, lock=True):
    """Load an interview (row-locked by default) and require ownership."""
    interview = adaptive_service.fetch_interview(cur, interview_id, lock=lock)
    authorize_interview(cur, interview, user)
    return interview


# -------------------------------------------------------------
# BLOCK 4: Request models (validated by Pydantic)
# -------------------------------------------------------------
class StartInterviewRequest(BaseModel):
    # Identity comes from the verified token; firebase_uid/user_id are
    # accepted for older frontend builds but ignored.
    firebase_uid: Optional[str] = None
    email: Optional[str] = None
    full_name: Optional[str] = None
    user_id: Optional[str] = None
    role_title: str = Field(default="Software Engineer", max_length=100)
    job_description: Optional[str] = None
    interview_mode: Literal["standard", "game"] = "standard"
    max_turns: int = Field(default=5, ge=1, le=20)


class HintRequest(BaseModel):
    current_turn: int = Field(ge=1, le=6)


class NextQuestionRequest(BaseModel):
    # Optional token makes retries unambiguous even after another answer arrives.
    response_id: Optional[uuid.UUID] = None


class EvaluateInterviewRequest(BaseModel):
    # {"eyeContact": 0-100, ...} from the browser's BehaviorMonitor; omitted
    # when the camera model never produced data.
    vision_metrics: Optional[dict] = None
    duration_seconds: int = Field(default=0, ge=0, le=24 * 60 * 60)


def _clean(value: Optional[str]) -> Optional[str]:
    """Strip a string; turn blank strings into None."""
    return value.strip() if value and value.strip() else None


# -------------------------------------------------------------
# BLOCK 5: Response shape shared by /complete and /report
# -------------------------------------------------------------
def completion_response(report):
    """Stable report contract for the first submission and every retry.

    Components without data (e.g. camera engagement when the camera model
    never loaded) are left out of ``scores`` instead of shown as 0.
    """
    speech_fluency = report.get("speech_fluency_score")
    if speech_fluency is None:
        speech_fluency = report.get("voice_confidence_score")
    scores = [
        {"label": "Answer Quality", "value": report["answer_quality_score"]},
        {"label": "Communication", "value": report["communication_score"]},
        {"label": "Speech Fluency", "value": speech_fluency},
        {"label": "Camera Engagement", "value": report["camera_engagement_score"]},
    ]
    return {
        "interview_id": str(report["interview_id"]),
        "overall_score": report["overall_score"],
        "scores": [score for score in scores if score["value"] is not None],
        "speech_fluency_score": speech_fluency,
        "camera_engagement_score": report["camera_engagement_score"],
        "strengths": report["strengths"], "improvements": report["improvements"],
        "feedback": report["summary_feedback"], "nlp_metrics": report["nlp_metrics"],
    }


# -------------------------------------------------------------
# BLOCK 6: POST /api/interviews/start
# -------------------------------------------------------------
# 1. Resolve (or create) the internal user for the token's Firebase UID.
# 2. Insert the interview row with role, optional job description and mode.
# 3. Generate ONLY the first (medium) question and store its private rubric
#    and rubric embeddings; later questions depend on the candidate's answers.
# 4. Arena sessions also get their arena_stats row.
@app.post("/api/interviews/start")
def start_interview(payload: StartInterviewRequest, user: AuthUser = Depends(auth.current_user)):
    firebase_uid = user.uid
    max_turns = 6 if payload.interview_mode == "game" else payload.max_turns
    # The token's email is verified by Firebase; prefer it over the body.
    email = _clean(user.email) or _clean(payload.email)
    full_name = _clean(payload.full_name) or _clean(user.name)
    role_title = _clean(payload.role_title) or "Software Engineer"

    with transaction("Could not start the interview. Please retry.") as (_conn, cur):
        # Step A: Map the external Firebase identity to the internal UUID.
        cur.execute("SELECT id FROM users WHERE firebase_uid = %s;", (firebase_uid,))
        user_row = cur.fetchone()
        if user_row:
            user_id = str(user_row["id"])
            cur.execute(
                """
                UPDATE users
                SET email = COALESCE(%s, email),
                    full_name = COALESCE(%s, full_name)
                WHERE id = %s;
                """,
                (email, full_name, user_id)
            )
        else:
            cur.execute(
                """
                INSERT INTO users (firebase_uid, email, full_name)
                VALUES (%s, %s, %s)
                ON CONFLICT (firebase_uid) DO UPDATE
                SET email = COALESCE(EXCLUDED.email, users.email),
                    full_name = COALESCE(EXCLUDED.full_name, users.full_name)
                RETURNING id;
                """,
                (firebase_uid, email, full_name)
            )
            user_id = str(cur.fetchone()["id"])

        # Step B: Create the interview session.
        cur.execute(
            """
            INSERT INTO interviews (user_id, role_title, job_description, status, max_turns, interview_mode)
            VALUES (%s, %s, %s, 'in_progress', %s, %s)
            RETURNING id;
            """,
            (user_id, role_title, payload.job_description, max_turns, payload.interview_mode)
        )
        interview_id = str(cur.fetchone()["id"])

        # Step C: First question (Gemini, or the offline fallback).
        content = gemini_service.generate_adaptive_question(
            role_title=role_title,
            job_description=(payload.job_description or "")[:4000],
            current_difficulty="medium", is_follow_up=False,
            recent_history=[], turn_number=1, max_turns=max_turns,
        )
        question = adaptive_service.public_question(
            adaptive_service.store_question(cur, interview_id, 1, content)
        )
        if payload.interview_mode == "game":
            arena.initialize(cur, interview_id)

    return {
        "interview_id": interview_id,
        "role_title": role_title,
        "job_description": payload.job_description,
        "interview_mode": payload.interview_mode,
        "current_turn": 1, "current_difficulty": "medium",
        "max_turns": max_turns, "question": question,
        # Shape compatibility only: one turn, never a pre-generated set.
        "questions": [question],
    }


# -------------------------------------------------------------
# BLOCK 7: POST /api/interviews/{id}/submit-answer
# -------------------------------------------------------------
# Multipart form: question_index, question_text (ignored for grading),
# candidate_answer and an optional .webm video.
# 1. Lock the interview. A retry of an already accepted answer returns the
#    stored result; a *different* answer for that question is a 409.
# 2. Save the video, then embed → retrieve rubric → grade → persist.
@app.post("/api/interviews/{interview_id}/submit-answer")
def submit_answer(
    interview_id: str,
    question_index: int = Form(...),
    question_text: str = Form(""),
    candidate_answer: str = Form(""),
    video: Optional[UploadFile] = File(None),
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not save and evaluate this answer. Please retry.") as (conn, cur):
        interview = owned_interview(cur, interview_id, user)
        adaptive_service.require_active(interview)

        # Step A: Check for a previously accepted submission BEFORE checking
        # current_turn, so a retry after advancement cannot overwrite it.
        cur.execute(
            "SELECT * FROM interview_questions WHERE interview_id = %s AND question_index = %s;",
            (interview_id, question_index),
        )
        question = cur.fetchone()
        if question:
            previous = adaptive_service.existing_submission(cur, question)
            if previous:
                if previous["candidate_answer"] != candidate_answer:
                    raise HTTPException(409, "This question already has an accepted answer.")
                return adaptive_service.submission_result(previous)

        # Step B: Grade only the question issued by the server; the client's
        # question_text is kept in the form for compatibility but never trusted.
        question = adaptive_service.question_for_submission(cur, interview, question_index)
        video_url = None
        if video and video.filename:
            video_url = save_answer_video(interview_id, question_index, video)
        response = adaptive_service.evaluate_and_store(
            conn, cur, interview, question, candidate_answer, video_url,
        )
        return adaptive_service.submission_result(response)


# -------------------------------------------------------------
# BLOCK 8: POST /api/interviews/{id}/next-question
# -------------------------------------------------------------
@app.post("/api/interviews/{interview_id}/next-question")
def next_question(
    interview_id: str,
    payload: Optional[NextQuestionRequest] = None,
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not advance the interview. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user)
        return adaptive_service.advance(cur, interview, payload.response_id if payload else None)


# -------------------------------------------------------------
# BLOCK 9: Arena endpoints
# -------------------------------------------------------------
@app.post("/api/interviews/{interview_id}/hint")
def arena_hint(interview_id: str, payload: HintRequest, user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not request a hint. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user)
        return arena.use_hint(cur, interview, payload.current_turn)


@app.get("/api/interviews/{interview_id}/arena-results")
def arena_results(interview_id: str, user: AuthUser = Depends(auth.current_user)):
    # Read-only: no row lock, so viewing results never blocks an active turn.
    with transaction("Could not load Arena results. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        return arena.results(cur, interview)


# -------------------------------------------------------------
# BLOCK 10: POST /api/interviews/{id}/complete  (Standard mode)
# -------------------------------------------------------------
# 1. Return the saved report if this interview was already completed.
# 2. Require every configured turn to be answered and evaluated.
# 3. Reuse per-answer scores (only pre-adaptive sessions are batch-graded).
# 4. Combine answer quality, communication, camera engagement and speech
#    fluency (see scoring.py) and save the report.
def _legacy_evaluation_items(cur, interview_id, responses):
    """Build batch-grading input for answers saved before adaptive grading."""
    items = []
    for item in responses:
        if item.get("question_id"):
            continue
        cur.execute(
            """
            SELECT ideal_concept_chunk FROM question_rubrics
            WHERE interview_id = %s AND question_index = %s;
            """,
            (interview_id, item["question_index"])
        )
        answer = item["candidate_answer"] or ""
        items.append({
            "question_index": item["question_index"],
            "question_text": item["question_text"],
            "candidate_answer": answer,
            "rubric_points": [r["ideal_concept_chunk"] for r in cur.fetchall()],
            "similarity_score": float(item["semantic_similarity_score"] or 0.0),
            "filler_count": scoring.aggregate_fillers([answer])["total_fillers"],
        })
    return items


@app.post("/api/interviews/{interview_id}/complete")
def complete_and_evaluate_interview(
    interview_id: str,
    payload: EvaluateInterviewRequest,
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not complete this interview. Please retry.") as (_conn, cur):
        # Step A: Lock and validate the session; replay a saved report.
        interview = owned_interview(cur, interview_id, user)
        if interview.get("interview_mode") == "game":
            raise HTTPException(409, "Arena completes through next-question; use arena-results for its summary.")
        if interview["status"] in ("completed", "evaluated"):
            cur.execute("SELECT * FROM evaluation_reports WHERE interview_id = %s;", (interview_id,))
            report = cur.fetchone()
            if report:
                return completion_response(report)
        adaptive_service.require_active(interview)

        cur.execute(
            """
            SELECT *
            FROM interview_responses
            WHERE interview_id = %s
            ORDER BY question_index ASC;
            """,
            (interview_id,)
        )
        responses = cur.fetchall()
        if not responses:
            raise HTTPException(status_code=400, detail="No answers found for this interview.")

        adaptive_responses = [r for r in responses if r.get("question_id")]
        if adaptive_responses and (
            len(adaptive_responses) != interview["max_turns"]
            or any(r["evaluated_at"] is None for r in adaptive_responses)
        ):
            raise HTTPException(409, "Answer all configured turns before completing this interview.")

        # Step B: Per-answer evaluations (saved, or batch-graded for legacy).
        filler_summary = scoring.aggregate_fillers(r["candidate_answer"] for r in responses)
        if adaptive_responses:
            batch_result = {"question_evaluations": adaptive_responses, "overall_summary": ""}
        else:
            batch_result = gemini_service.batch_evaluate_interview(
                role_title=interview["role_title"],
                job_description=interview["job_description"],
                evaluation_items=_legacy_evaluation_items(cur, interview_id, responses),
            )
        evaluations = batch_result.get("question_evaluations", [])

        # Step C: Component scores and weighted overall score.
        neutral = scoring.NEUTRAL_SCORE
        answer_quality = scoring.average_score(
            int(ev.get("answer_quality_score", neutral)) for ev in evaluations)
        communication = scoring.average_score(
            int(ev.get("communication_score", neutral)) for ev in evaluations)
        vision_metrics = payload.vision_metrics or {}
        camera = scoring.camera_engagement(vision_metrics)
        fluency = scoring.speech_fluency(filler_summary["total_fillers"], len(responses))
        overall = scoring.overall_score(answer_quality, communication, camera, fluency)

        # Step D: Top unique strengths/improvements and summary text.
        strengths = list(batch_result.get("overall_strengths", []))
        improvements = list(batch_result.get("overall_improvements", []))
        for ev in evaluations:
            strengths.extend(ev.get("strengths") or [])
            improvements.extend(ev.get("improvements") or [])
        top_strengths = list(dict.fromkeys(strengths))[:4]
        top_improvements = list(dict.fromkeys(improvements))[:4]
        summary_feedback = (batch_result.get("overall_summary") or "").strip()
        if not summary_feedback:
            camera_text = (f"camera engagement reached {camera}%" if camera is not None
                           else "camera engagement was not measured")
            summary_feedback = (
                f"Overall score: {overall}/100. "
                f"Answer quality averaged {answer_quality}% and {camera_text}. "
                f"Focus on reducing the {filler_summary['total_fillers']} filler words used across the session."
            )

        # Step E: Persist the report and close the interview.
        cur.execute(
            """
            INSERT INTO evaluation_reports (
                interview_id, answer_quality_score, communication_score,
                voice_confidence_score, speech_fluency_score, camera_engagement_score, overall_score,
                vision_metrics, nlp_metrics, strengths, improvements, summary_feedback
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (
                interview_id, answer_quality, communication,
                fluency,  # voice_confidence_score: legacy column, mirrors fluency
                fluency, camera, overall,
                json.dumps(vision_metrics), json.dumps(filler_summary),
                top_strengths, top_improvements, summary_feedback,
            )
        )
        cur.execute(
            """
            UPDATE interviews
            SET status = 'completed',
                overall_score = %s,
                duration_seconds = %s,
                completed_at = NOW()
            WHERE id = %s;
            """,
            (overall, payload.duration_seconds, interview_id)
        )

    return completion_response({
        "interview_id": interview_id,
        "overall_score": overall,
        "answer_quality_score": answer_quality,
        "communication_score": communication,
        "speech_fluency_score": fluency,
        "camera_engagement_score": camera,
        "strengths": top_strengths, "improvements": top_improvements,
        "summary_feedback": summary_feedback, "nlp_metrics": filler_summary,
    })


# -------------------------------------------------------------
# BLOCK 11: GET /api/interviews/{id}/report  (Report page)
# -------------------------------------------------------------
@app.get("/api/interviews/{interview_id}/report")
def get_interview_report(interview_id: str, user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not load this report. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        cur.execute("SELECT * FROM evaluation_reports WHERE interview_id = %s;", (interview_id,))
        report = cur.fetchone()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found.")
        turns = adaptive_service.report_turns(cur, interview_id)

    return {
        **completion_response(report),
        # Raw columns kept for older clients that read them directly.
        "answer_quality_score": report["answer_quality_score"],
        "communication_score": report["communication_score"],
        "summary_feedback": report["summary_feedback"],
        "created_at": report.get("created_at"),
        "role_title": interview["role_title"],
        "interview_mode": interview.get("interview_mode"),
        "duration_seconds": interview.get("duration_seconds"),
        "turns": turns,
    }


# -------------------------------------------------------------
# BLOCK 12: GET /api/interviews/user/{firebase_uid}  (Dashboard)
# -------------------------------------------------------------
@app.get("/api/interviews/user/{firebase_uid}")
def get_user_interviews(firebase_uid: str, user: AuthUser = Depends(auth.current_user)):
    auth.require_self(firebase_uid, user)
    with transaction("Could not load interview history. Please retry.") as (_conn, cur):
        cur.execute("SELECT id FROM users WHERE firebase_uid = %s;", (firebase_uid,))
        user_row = cur.fetchone()
        if not user_row:
            return []
        cur.execute(
            """
            SELECT id, role_title, interview_mode, status, duration_seconds, overall_score, created_at, completed_at
            FROM interviews
            WHERE user_id = %s
            ORDER BY created_at DESC;
            """,
            (str(user_row["id"]),)
        )
        return cur.fetchall()


# -------------------------------------------------------------
# BLOCK 13: DELETE /api/interviews/{id}  (My Interviews)
# -------------------------------------------------------------
# Only the owner may delete. Child rows (questions, responses, rubrics,
# reports, Arena state) are removed by ON DELETE CASCADE; saved answer
# videos are removed from disk after the transaction commits.
@app.delete("/api/interviews/{interview_id}")
def delete_interview(interview_id: str, user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not delete this interview. Please retry.") as (_conn, cur):
        owned_interview(cur, interview_id, user)
        cur.execute("DELETE FROM interviews WHERE id = %s;", (interview_id,))

    canonical_id = str(uuid.UUID(interview_id))
    shutil.rmtree(os.path.join(UPLOAD_DIR, canonical_id), ignore_errors=True)
    return {"status": "deleted", "interview_id": canonical_id}


# -------------------------------------------------------------
# BLOCK 14: Profile  (Profile page)
# -------------------------------------------------------------
class ProfileUpdateRequest(BaseModel):
    email: Optional[str] = Field(default=None, max_length=255)
    full_name: Optional[str] = Field(default=None, max_length=255)


def _profile_stats(cur, user_id):
    """Aggregate practice statistics for one internal user id."""
    cur.execute(
        """
        SELECT
            COUNT(*) AS total_interviews,
            COUNT(*) FILTER (WHERE status IN ('completed', 'evaluated')) AS completed_interviews,
            COUNT(*) FILTER (WHERE interview_mode = 'standard') AS standard_interviews,
            COUNT(*) FILTER (WHERE interview_mode = 'game') AS arena_sessions,
            ROUND(AVG(overall_score) FILTER (WHERE status IN ('completed', 'evaluated')))::INT AS average_score,
            MAX(overall_score) FILTER (WHERE status IN ('completed', 'evaluated')) AS best_score,
            COALESCE(SUM(duration_seconds), 0)::INT AS total_practice_seconds,
            MAX(created_at) AS last_interview_at
        FROM interviews
        WHERE user_id = %s;
        """,
        (user_id,)
    )
    return cur.fetchone()


def _profile_response(firebase_uid, user_row, stats):
    return {
        "firebase_uid": firebase_uid,
        "exists": user_row is not None,
        "email": user_row["email"] if user_row else None,
        "full_name": user_row["full_name"] if user_row else None,
        "created_at": user_row["created_at"] if user_row else None,
        "stats": stats or {
            "total_interviews": 0, "completed_interviews": 0,
            "standard_interviews": 0, "arena_sessions": 0,
            "average_score": None, "best_score": None,
            "total_practice_seconds": 0, "last_interview_at": None,
        },
    }


@app.get("/api/users/{firebase_uid}/profile")
def get_profile(firebase_uid: str, user: AuthUser = Depends(auth.current_user)):
    auth.require_self(firebase_uid, user)
    with transaction("Could not load your profile. Please retry.") as (_conn, cur):
        cur.execute(
            "SELECT id, email, full_name, created_at FROM users WHERE firebase_uid = %s;",
            (firebase_uid,)
        )
        user_row = cur.fetchone()
        stats = _profile_stats(cur, str(user_row["id"])) if user_row else None
    return _profile_response(firebase_uid, user_row, stats)


@app.put("/api/users/{firebase_uid}/profile")
def update_profile(
    firebase_uid: str,
    payload: ProfileUpdateRequest,
    user: AuthUser = Depends(auth.current_user),
):
    """Create or update the user's profile metadata (name/email from Firebase)."""
    auth.require_self(firebase_uid, user)
    with transaction("Could not save your profile. Please retry.") as (_conn, cur):
        cur.execute(
            """
            INSERT INTO users (firebase_uid, email, full_name)
            VALUES (%s, %s, %s)
            ON CONFLICT (firebase_uid) DO UPDATE
            SET email = COALESCE(EXCLUDED.email, users.email),
                full_name = COALESCE(EXCLUDED.full_name, users.full_name)
            RETURNING id, email, full_name, created_at;
            """,
            (firebase_uid, _clean(payload.email), _clean(payload.full_name))
        )
        user_row = cur.fetchone()
        stats = _profile_stats(cur, str(user_row["id"]))
    return _profile_response(firebase_uid, user_row, stats)


# -------------------------------------------------------------
# BLOCK 15: GET /api/users/{firebase_uid}/reports  (Reports page)
# -------------------------------------------------------------
# Every saved Standard evaluation with its component scores, newest first.
@app.get("/api/users/{firebase_uid}/reports")
def get_user_reports(firebase_uid: str, user: AuthUser = Depends(auth.current_user)):
    auth.require_self(firebase_uid, user)
    with transaction("Could not load your reports. Please retry.") as (_conn, cur):
        cur.execute("SELECT id FROM users WHERE firebase_uid = %s;", (firebase_uid,))
        user_row = cur.fetchone()
        if not user_row:
            return []
        cur.execute(
            """
            SELECT i.id AS interview_id, i.role_title, i.duration_seconds,
                   i.created_at, i.completed_at,
                   r.overall_score, r.answer_quality_score, r.communication_score,
                   COALESCE(r.speech_fluency_score, r.voice_confidence_score) AS speech_fluency_score,
                   r.camera_engagement_score, r.strengths, r.improvements,
                   r.created_at AS evaluated_at
            FROM evaluation_reports r
            JOIN interviews i ON i.id = r.interview_id
            WHERE i.user_id = %s
            ORDER BY r.created_at DESC;
            """,
            (str(user_row["id"]),)
        )
        return cur.fetchall()


# -------------------------------------------------------------
# BLOCK 16: GET /api/health
# -------------------------------------------------------------
@app.get("/api/health")
def health():
    """Report API liveness and whether PostgreSQL and Gemini are configured."""
    return {
        "status": "ok",
        "database": database.test_db_connection(),
        "gemini_configured": bool(config.GEMINI_API_KEY),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=True)
