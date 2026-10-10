"""FastAPI entry point for the AI Interview Evaluation System.

Run from the repository root:
    python -m uvicorn main:app --app-dir backend --reload --port 8000

Every endpoint except /health requires ``Authorization: Bearer <Firebase ID
token>`` (see auth.py). Interview endpoints only act on interviews owned by
the signed-in user; /users/{firebase_uid} paths must name that user.

Endpoints (all under /api):
    POST /interviews/start                  create a session + first question
    POST /interviews/{id}/transcribe        speech-to-text for a recorded answer
    POST /interviews/{id}/recording         whole-interview recording chunk
    GET  /interviews/{id}/recording/{part}  owner-only interview recording
    GET  /interviews/{id}/speech/{item}     spoken intro/outro/question (Piper)
    GET  /speech/{phrase}                   fixed spoken phrases (Piper)
    POST /interviews/{id}/proctoring        integrity events (leaving the interview…)
    POST /interviews/{id}/identity/enroll   enrolment photo + spoken sentence
    POST /interviews/{id}/identity/snapshot face check against the enrolment
    GET  /interviews/{id}/identity/images/{name}  owner-only evidence images
    GET  /coding/languages                  languages the VPL can run here
    POST /interviews/{id}/code/run          run code on the visible examples
    POST /interviews/{id}/code/submit       grade a coding answer on all tests
    POST /interviews/{id}/arena-end         end a ranked Arena early (penalties)
    GET  /arena/leaderboard                 ranking, overall or by category
    GET  /arena/me                          the signed-in user's ratings and ranks
    POST /interviews/{id}/submit-answer     save, embed and grade one answer
    POST /interviews/{id}/next-question     apply policy, issue the next turn
    POST /interviews/{id}/hint              Arena only: spend the one hint
    POST /interviews/{id}/complete          Standard only: build final report
    GET  /interviews/{id}/report            saved Standard report + turns
    GET  /interviews/{id}/arena-results     saved Arena summary
    GET  /interviews/user/{firebase_uid}    a user's interview history
    DELETE /interviews/{id}                 owner deletes one interview
    GET  /interviews/{id}/media/{n}         owner-only answer recording
    GET  /interviews/{id}/state             resume an active interview
    GET  /users/{firebase_uid}/profile      profile + practice statistics
    PUT  /users/{firebase_uid}/profile      create/update name and email
    GET  /users/{firebase_uid}/reports      saved Standard reports + scores
    GET  /health                            liveness + database check
"""
import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import config  # loads backend/.env before the modules below read settings
import adaptive_service
import arena
import auth
from auth import AuthUser
import database
import integrity
import gemini_service
import assessment
import coding
import code_runner
import identity
import malpractice
import nlp_evaluator
import ranking
import resume
import scoring
import speech_analysis
import stt_service
import tts_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("interview-api")


# -------------------------------------------------------------
# BLOCK 1: Application, lifespan and CORS
# -------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Check PostgreSQL once at startup; the API still starts if it is down.

    The speech-to-text model and the text-to-speech voice are loaded in
    background threads so the first request does not pay the loading cost.
    """
    logger.info("Server starting; checking PostgreSQL connection")
    database.test_db_connection()
    threading.Thread(target=stt_service.warm_up, daemon=True).start()
    threading.Thread(target=tts_service.warm_up, daemon=True).start()
    threading.Thread(target=identity.warm_up, daemon=True).start()
    threading.Thread(target=coding.warm_up, daemon=True).start()
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


# Browsers record WebM (Chrome, Firefox, Edge) or MP4 (Safari).
MEDIA_EXTENSIONS = {"webm": "webm", "mp4": "mp4", "ogg": "ogg", "mpeg": "mp3", "wav": "wav", "x-wav": "wav"}


def media_filename(question_index: int, kind: str, content_type: Optional[str] = None) -> str:
    """``q_<n>.webm`` for video, ``q_<n>_audio.<ext>`` for audio."""
    subtype = ((content_type or "").split(";")[0].split("/")[-1] or "webm").lower()
    extension = MEDIA_EXTENSIONS.get(subtype, "webm")
    return f"q_{question_index}.{extension}" if kind == "video" else f"q_{question_index}_audio.{extension}"


def save_upload(interview_id: str, filename: str, upload: UploadFile) -> str:
    """Stream an upload to backend/uploads/<id>/<filename>; return the absolute path.

    Rejects files larger than MAX_UPLOAD_MB with HTTP 413 and removes the
    partial file. The canonical UUID is used for the folder whatever case
    the client sent.
    """
    canonical_id = str(uuid.UUID(interview_id))
    folder = os.path.join(UPLOAD_DIR, canonical_id)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, filename)

    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    written = 0
    with open(path, "wb") as buffer:
        while chunk := upload.file.read(UPLOAD_CHUNK_BYTES):
            written += len(chunk)
            if written > limit:
                break
            buffer.write(chunk)
    if written > limit:
        os.remove(path)
        raise HTTPException(413, f"Recording exceeds the {config.MAX_UPLOAD_MB} MB limit.")
    return path


def save_answer_video(interview_id: str, question_index: int, video: UploadFile) -> str:
    """Save an answer video and return its storage path (relative to uploads)."""
    canonical_id = str(uuid.UUID(interview_id))
    filename = media_filename(question_index, "video", video.content_type)
    save_upload(interview_id, filename, video)
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
    # Plain text from POST /api/resume/parse; questions are tailored to it.
    resume_text: Optional[str] = Field(default=None, max_length=resume.MAX_RESUME_CHARS)
    interview_mode: Literal["standard", "game"] = "standard"
    # How answers are given: "voice" (spoken, transcribed) or "typed".
    answer_mode: Literal["voice", "typed"] = "typed"
    max_turns: int = Field(default=5, ge=1, le=20)
    # Coding round in the VPL: None decides from the role and job description.
    coding_round: Optional[bool] = None
    # Arena ranking category (see ranking.CATEGORIES).
    arena_category: Optional[str] = Field(default=None, max_length=30)


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
    # True when proctoring ended the interview before every turn was
    # answered; unanswered turns then score 0.
    ended_early: bool = False
    # Why it ended early: "away" (stayed outside too long) or "violations".
    end_reason: Optional[Literal["away", "violations"]] = None


class ProctoringEvent(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: str = Field(max_length=30)
    question_index: Optional[int] = Field(default=None, ge=1, le=50)
    part: Optional[int] = Field(default=None, ge=1, le=50)
    at: Optional[float] = Field(default=None, ge=0, le=24 * 60 * 60)
    duration: Optional[float] = Field(default=None, ge=0, le=24 * 60 * 60)
    details: dict = Field(default_factory=dict)


class ProctoringBatch(BaseModel):
    events: list[ProctoringEvent] = Field(max_length=50)


def _clean(value: Optional[str]) -> Optional[str]:
    """Strip a string; turn blank strings into None."""
    return value.strip() if value and value.strip() else None


# -------------------------------------------------------------
# BLOCK 5: Response shape shared by /complete and /report
# -------------------------------------------------------------
def completion_response(report, comp=None):
    """Stable report contract for the first submission and every retry.

    Components without data (e.g. camera engagement when the camera model
    never loaded) are left out of ``scores`` instead of shown as 0. When no
    question was answered, Speech Fluency stays in the list as ``null`` so the
    page can show "—". ``comp`` is the completion summary (scoring.completion).
    """
    insufficient = bool(comp) and comp["answered"] == 0
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
        "scores": [score for score in scores
                   if score["value"] is not None or (insufficient and score["label"] == "Speech Fluency")],
        "speech_fluency_score": speech_fluency,
        "camera_engagement_score": report["camera_engagement_score"],
        "strengths": report["strengths"], "improvements": report["improvements"],
        "feedback": report["summary_feedback"], "nlp_metrics": report["nlp_metrics"],
        # Scoring v2 detail; absent (None) on reports saved before v2.
        "criteria_scores": report.get("criteria_scores"),
        "speech_metrics": report.get("speech_metrics"),
        "vision_metrics": report.get("vision_metrics"),
        "scoring": {
            "version": report.get("scoring_version") or 1,
            "weights": report.get("scoring_weights"),
        },
        "integrity": report.get("integrity"),
        "completion": comp,
        "insufficient_responses": insufficient,
    }


# -------------------------------------------------------------
# BLOCK 5b: POST /api/resume/parse
# -------------------------------------------------------------
# Reads an uploaded resume (PDF, DOCX or TXT) and returns its plain text.
# Nothing is stored here: the browser sends the text back when it starts the
# interview, and it is saved with that interview only.
@app.post("/api/resume/parse")
async def parse_resume(file: UploadFile = File(...), user: AuthUser = Depends(auth.current_user)):
    content = await file.read(resume.MAX_RESUME_BYTES + 1)
    try:
        text = resume.extract_text(file.filename, content)
    except resume.ResumeError as err:
        raise HTTPException(status_code=422, detail=str(err))
    return {"filename": os.path.basename(file.filename or "resume"), "characters": len(text), "resume_text": text}


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
    coding_round = (payload.coding_round if payload.coding_round is not None
                    else coding.suggests_coding(role_title, payload.job_description))
    # Resumes only shape Standard interviews; Arena questions stay generic.
    resume_text = resume.clean_text(payload.resume_text) if payload.interview_mode == "standard" else ""
    resume_text = resume_text or None
    arena_category = None
    if payload.interview_mode == "game":
        arena_category = payload.arena_category if payload.arena_category in ranking.CATEGORIES else "general"

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
            INSERT INTO interviews (user_id, role_title, job_description, status, max_turns,
                                    answer_mode, interview_mode, coding_round, arena_category, resume_text)
            VALUES (%s, %s, %s, 'in_progress', %s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (user_id, role_title, payload.job_description, max_turns,
             "typed" if payload.interview_mode == "game" else payload.answer_mode, payload.interview_mode,
             coding_round, arena_category, resume_text)
        )
        interview_id = str(cur.fetchone()["id"])

        # Step C: First question (Gemini, or the offline fallback).
        content = gemini_service.generate_adaptive_question(
            role_title=role_title,
            job_description=(payload.job_description or "")[:4000],
            **resume.prompt_context(resume_text),
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
        "resume_used": bool(resume_text),
        "interview_mode": payload.interview_mode,
        "answer_mode": "typed" if payload.interview_mode == "game" else payload.answer_mode,
        "proctoring": {"max_violations": config.PROCTORING_MAX_VIOLATIONS,
                       "max_away_seconds": config.PROCTORING_MAX_AWAY_SECONDS},
        "identity": {"enabled": identity.enabled(), "enrolled": False},
        "coding_round": coding_round,
        "arena_category": arena_category,
        "current_turn": 1, "current_difficulty": "medium",
        "max_turns": max_turns, "question": question,
        # Shape compatibility only: one turn, never a pre-generated set.
        "questions": [question],
    }


# -------------------------------------------------------------
# BLOCK 7: POST /api/interviews/{id}/submit-answer
# -------------------------------------------------------------
# Multipart form: question_index, question_text (ignored for grading),
# candidate_answer, an optional video and optional vision_metrics (JSON of
# this answer's camera-engagement snapshot from the browser).
# 1. Lock the interview. A retry of an already accepted answer returns the
#    stored result; a *different* answer for that question is a 409.
# 2. Save the video, then embed → retrieve rubric → grade → persist. A
#    transcript saved by /transcribe for this turn is attached automatically.
def _parse_vision(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        return scoring.sanitize_vision(json.loads(raw))
    except (ValueError, TypeError):
        return None


def _parse_signals(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        return malpractice.sanitize_signals(json.loads(raw[:20000]))
    except (ValueError, TypeError):
        return None


def _recording_position(part, start, end) -> Optional[dict]:
    """Where an answer sits in the session recording; None when invalid."""
    numbers = (int, float)
    if not (isinstance(part, int) and isinstance(start, numbers) and isinstance(end, numbers)):
        return None
    if not (1 <= part <= 50 and 0 <= start <= end <= 24 * 60 * 60):
        return None
    return {"part": part, "start": round(start, 2), "end": round(end, 2)}


@app.post("/api/interviews/{interview_id}/submit-answer")
def submit_answer(
    interview_id: str,
    question_index: int = Form(...),
    question_text: str = Form(""),
    candidate_answer: str = Form(""),
    video: Optional[UploadFile] = File(None),
    vision_metrics: Optional[str] = Form(None),
    recording_part: Optional[int] = Form(None),
    answer_start_seconds: Optional[float] = Form(None),
    answer_end_seconds: Optional[float] = Form(None),
    answer_signals: Optional[str] = Form(None),
    user: AuthUser = Depends(auth.current_user),
):
    recording = _recording_position(recording_part, answer_start_seconds, answer_end_seconds)
    signals = _parse_signals(answer_signals)
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
        if question.get("kind") == "coding":
            raise HTTPException(409, "This is a coding question; submit code with /code/submit.")
        video_url = None
        if video and video.filename:
            video_url = save_answer_video(interview_id, question_index, video)
        response = adaptive_service.evaluate_and_store(
            conn, cur, interview, question, candidate_answer, video_url,
            vision_metrics=_parse_vision(vision_metrics), recording=recording,
            answer_signals=signals,
        )
        return adaptive_service.submission_result(response)


# -------------------------------------------------------------
# BLOCK 7b: POST /api/interviews/{id}/transcribe  (speech-to-text)
# -------------------------------------------------------------
# Multipart form: question_index and an audio recording of the answer.
# Returns the transcript for the candidate to review; it does NOT grade.
# Three steps so no database lock is held while Whisper runs:
#   1. short transaction: ownership, active session, current turn;
#   2. save audio + transcribe + delivery metrics (no database);
#   3. short transaction: upsert the transcript for this turn.
# Re-recording replaces the previous transcript for the same turn.
@app.post("/api/interviews/{interview_id}/transcribe")
def transcribe_answer(
    interview_id: str,
    question_index: int = Form(...),
    audio: UploadFile = File(...),
    user: AuthUser = Depends(auth.current_user),
):
    content_type = (audio.content_type or "").lower()
    if not content_type.startswith(("audio/", "video/")):
        raise HTTPException(415, "Upload an audio recording.")

    with transaction("Could not prepare transcription. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        question = adaptive_service.question_for_submission(cur, interview, question_index)
        cur.execute(
            """SELECT 1 FROM interview_responses
               WHERE interview_id = %s AND question_index = %s;""",
            (interview_id, question_index),
        )
        if cur.fetchone():
            raise HTTPException(409, "This question already has an accepted answer.")
        voice_gallery = _voice_gallery(cur, interview_id)

    filename = media_filename(question_index, "audio", content_type)
    path = save_upload(interview_id, filename, audio)
    try:
        result = stt_service.transcribe(path, content_type, context=question["question_text"])
    except stt_service.TranscriptionError as err:
        raise HTTPException(422, str(err))
    if not result["text"].strip():
        raise HTTPException(422, "No speech was detected in the recording. Please try again.")
    metrics = speech_analysis.compute_metrics(result["words"], result["text"])
    voice_check = _check_voice(path, result["words"], voice_gallery)

    with transaction("Could not save the transcript. Please retry.") as (_conn, cur):
        cur.execute(
            """INSERT INTO answer_transcripts
               (interview_id, question_index, transcript, words, speech_metrics,
                source, model, language, duration_seconds, audio_path)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (interview_id, question_index) DO UPDATE SET
                 transcript = EXCLUDED.transcript, words = EXCLUDED.words,
                 speech_metrics = EXCLUDED.speech_metrics, source = EXCLUDED.source,
                 model = EXCLUDED.model, language = EXCLUDED.language,
                 duration_seconds = EXCLUDED.duration_seconds,
                 audio_path = EXCLUDED.audio_path, created_at = NOW();""",
            (interview_id, question_index, result["text"], json.dumps(result["words"]),
             json.dumps(metrics) if metrics else None, result["source"], result["model"],
             result["language"], result["duration_seconds"], filename),
        )
        identity_result = _store_voice_check(cur, interview_id, question_index, voice_check)

    return {
        "question_index": question_index,
        "transcript": result["text"],
        "source": result["source"],
        "duration_seconds": result["duration_seconds"],
        "speech_metrics": metrics,
        "identity": identity_result,
    }


def _voice_gallery(cur, interview_id: str) -> list:
    """Enrolled voice embeddings for an interview (empty when not enrolled)."""
    if not identity.enabled():
        return []
    cur.execute("SELECT voice_embeddings FROM identity_profiles WHERE interview_id = %s;", (interview_id,))
    row = cur.fetchone()
    return list((row or {}).get("voice_embeddings") or [])


def _check_voice(path: str, words: list, gallery: list) -> Optional[dict]:
    """Compare a spoken answer with the enrolled voice; None when not possible."""
    if not gallery:
        return None
    try:
        return identity.check_answer_voice(path, words, gallery)
    except identity.IdentityUnavailable:
        return None
    except Exception:
        logger.exception("Voice check failed")
        return None


def _violation_count(cur, interview_id: str) -> int:
    cur.execute("SELECT event_type, duration_seconds FROM proctoring_events WHERE interview_id = %s;",
                (interview_id,))
    return integrity.summarize(cur.fetchall())["violations"]


def _server_event(cur, interview_id: str, event_id: str, event_type: str, question_index=None,
                  details: Optional[dict] = None) -> None:
    """Record an integrity event raised by the server (idempotent per id)."""
    cur.execute(
        """INSERT INTO proctoring_events
           (interview_id, client_event_id, event_type, question_index, details)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (interview_id, client_event_id) DO NOTHING;""",
        (interview_id, event_id, event_type, question_index, json.dumps(details or {})),
    )


def _store_voice_check(cur, interview_id: str, question_index: int, check: Optional[dict]) -> Optional[dict]:
    """Save a voice check, grow the voiceprint on a confident match and
    raise a violation for another voice. Returns what the browser needs."""
    if not check:
        return None
    embedding = check.pop("embedding", None)
    cur.execute(
        """INSERT INTO identity_checks (interview_id, kind, question_index, verdict, similarity, details)
           VALUES (%s, 'voice', %s, %s, %s, %s);""",
        (interview_id, question_index, check["verdict"], check.get("similarity"), json.dumps(check)),
    )
    event = None
    if check["verdict"] == "match":
        cur.execute("SELECT voice_embeddings FROM identity_profiles WHERE interview_id = %s FOR UPDATE;",
                    (interview_id,))
        row = cur.fetchone()
        if row:
            gallery = identity.grow_gallery(list(row["voice_embeddings"] or []), embedding, check.get("similarity"))
            cur.execute("UPDATE identity_profiles SET voice_embeddings = %s WHERE interview_id = %s;",
                        (json.dumps(gallery), interview_id))
    elif check["verdict"] in ("mismatch", "mixed"):
        event = "voice_mismatch" if check["verdict"] == "mismatch" else "other_voice"
        _server_event(cur, interview_id, f"voice-{question_index}", event, question_index,
                      {"similarity": check.get("similarity"),
                       "segments": check.get("other_voice_segments", [])[:5]})
    return {
        "verdict": check["verdict"],
        "event": {"type": event, "label": integrity.LABELS[event]} if event else None,
        "violations": _violation_count(cur, interview_id),
        "max_violations": config.PROCTORING_MAX_VIOLATIONS,
    }


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
# 4. Integrity: assess every answer (identity checks, live events, browser
#    signals, reading detection; see malpractice.py), apply the penalties and
#    decide the verdict. An invalid interview scores 0 overall.
# 5. Combine answer quality, communication, camera engagement and speech
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
                return completion_response(report, scoring.completion(
                    adaptive_service.report_turns(cur, interview_id), interview["max_turns"]))
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
        ended_early = bool(payload.ended_early)
        if not responses and not ended_early:
            raise HTTPException(status_code=400, detail="No answers found for this interview.")

        adaptive_responses = [r for r in responses if r.get("question_id")]
        if ended_early:
            # Proctoring ended the interview: grade only accepted, evaluated answers.
            adaptive_responses = [r for r in adaptive_responses if r["evaluated_at"] is not None]
            responses = [r for r in responses if not r.get("question_id") or r["evaluated_at"] is not None]
        elif adaptive_responses and (
            len(adaptive_responses) != interview["max_turns"]
            or any(r["evaluated_at"] is None for r in adaptive_responses)
        ):
            raise HTTPException(409, "Answer all configured turns before completing this interview.")

        # Step B: Per-answer evaluations (saved, or batch-graded for legacy).
        # Only substantive answers (not skips) feed the averages; the share of
        # answered questions scales the final score once (scoring.final_score).
        comp = scoring.completion(responses, interview["max_turns"])
        substantive = [r for r in responses if scoring.is_substantive(r)]
        substantive_indexes = {r["question_index"] for r in substantive}
        spoken_substantive = [r for r in substantive if not r.get("coding_result")]
        filler_summary = scoring.aggregate_fillers(r["candidate_answer"] for r in spoken_substantive)
        if adaptive_responses or not responses:
            batch_result = {"question_evaluations": adaptive_responses, "overall_summary": ""}
        else:
            batch_result = gemini_service.batch_evaluate_interview(
                role_title=interview["role_title"],
                job_description=interview["job_description"],
                evaluation_items=_legacy_evaluation_items(cur, interview_id, responses),
            )
        evaluations = list(batch_result.get("question_evaluations", []))

        # Step B2: Integrity assessment and per-answer penalties (adaptive
        # answers only; legacy sessions have no identity or signal data).
        assessments, identity_summary = assessment.assess(cur, interview_id, adaptive_responses)
        assessment.store(cur, adaptive_responses, assessments)
        if adaptive_responses:
            evaluations = [malpractice.apply_penalty(ev, assessments[ev["question_index"]])
                           if ev.get("question_index") in assessments else ev for ev in evaluations]
        # Questions never answered (ended early) are not padded with zeros:
        # they already lower the completion ratio through max_turns.

        # Step C: Component scores and weighted overall score (scoring v3).
        # Averages describe the answers that were attempted; with none, 0.
        scored = [ev for ev in evaluations if ev.get("question_index") in substantive_indexes]
        neutral = scoring.NEUTRAL_SCORE
        if comp["answered"] == 0:
            answer_quality = communication = 0
            criteria = {name: 0 for name in gemini_service.CRITERIA_WEIGHTS}
        else:
            answer_quality = scoring.average_score(
                int(ev.get("answer_quality_score", neutral)) for ev in scored)
            communication = scoring.average_score(
                int(ev.get("communication_score", neutral)) for ev in scored)
            criteria = scoring.average_criteria(ev.get("criteria_scores") for ev in scored)

        # Speech: delivery measured from the audio when answers were spoken,
        # otherwise the text-only filler estimate. Skips are left out.
        speech_summary = speech_analysis.summarize([r.get("speech_metrics") for r in substantive])
        if comp["answered"] == 0:
            fluency = None
        elif speech_summary and speech_summary.get("delivery_score") is not None:
            fluency = speech_summary["delivery_score"]
        else:
            fluency = scoring.speech_fluency(filler_summary["total_fillers"], len(spoken_substantive))

        # Camera: mean of per-answer engagement; the browser's session
        # snapshot is only used for sessions without per-answer data.
        per_answer_vision = [r.get("vision_metrics") for r in responses]
        vision_summary = scoring.summarize_vision(per_answer_vision)
        per_answer_camera = [c for c in map(scoring.camera_engagement, per_answer_vision) if c is not None]
        if per_answer_camera:
            camera = round(sum(per_answer_camera) / len(per_answer_camera))
            vision_metrics = vision_summary
        else:
            vision_metrics = payload.vision_metrics or {}
            camera = scoring.camera_engagement(vision_metrics)

        weighted = scoring.overall_score(answer_quality, communication, camera, fluency)
        overall = scoring.final_score(weighted, comp)
        weights = scoring.applied_weights(answer_quality, communication, camera, fluency)

        # Integrity: proctoring summary, identity summary and the verdict.
        # Penalties were applied per answer above; an invalid interview
        # (identity not trustworthy) scores 0 overall.
        cur.execute(
            "SELECT event_type, duration_seconds FROM proctoring_events WHERE interview_id = %s;",
            (interview_id,),
        )
        integrity_summary = integrity.summarize(cur.fetchall(), vision_summary, ended_early)
        decision = malpractice.verdict(list(assessments.values()), identity_summary["face_mismatch_events"],
                                       integrity_summary["level"], len(adaptive_responses))
        integrity_summary.update(decision, identity=identity_summary, score_before_integrity=overall)
        if decision["verdict"] == "invalid":
            overall = 0

        # Step D: One holistic pass over the whole transcript (adaptive
        # sessions; legacy batch grading already wrote a summary), then the
        # top unique strengths/improvements and the summary text.
        holistic = None
        if adaptive_responses and comp["answered"] > 0:
            holistic = gemini_service.summarize_interview(
                interview["role_title"], interview["job_description"],
                [{"question": r["question_text"], "topic": r.get("topic"), "answer": r["candidate_answer"],
                  "answer_quality_score": r.get("answer_quality_score"),
                  "criteria_scores": r.get("criteria_scores")}
                 for r in adaptive_responses if scoring.is_substantive(r)],
            )
        if holistic:
            batch_result = {**batch_result, "overall_summary": holistic["summary"],
                            "overall_strengths": holistic["strengths"],
                            "overall_improvements": holistic["improvements"]}
        insufficient = comp["answered"] == 0
        if insufficient:
            # Nothing to praise or criticise in content, speech or criteria.
            module_strengths, module_improvements = scoring.insights(None, None, vision_summary)
            batch_result = {**batch_result, "overall_summary": "", "overall_strengths": [],
                            "overall_improvements": []}
            scored = []
        else:
            module_strengths, module_improvements = scoring.insights(criteria, speech_summary, vision_summary)
        strengths = list(batch_result.get("overall_strengths", [])) + module_strengths
        improvements = list(batch_result.get("overall_improvements", [])) + module_improvements
        if insufficient:
            improvements.append("Attempt every question; partial answers earn credit, skipped ones do not.")
        for ev in scored:
            strengths.extend(ev.get("strengths") or [])
            improvements.extend(ev.get("improvements") or [])
        top_strengths = list(dict.fromkeys(strengths))[:5]
        top_improvements = list(dict.fromkeys(improvements))[:5]
        summary_feedback = (batch_result.get("overall_summary") or "").strip()
        if insufficient:
            summary_feedback = (
                "Insufficient substantive responses were provided to evaluate interview performance. "
                f"All {comp['total']} questions were skipped or left unanswered."
            )
            if camera is not None:
                summary_feedback += f" Camera engagement was {camera}%."
        elif not summary_feedback:
            camera_text = (f"camera engagement reached {camera}%" if camera is not None
                           else "camera engagement was not measured")
            if speech_summary and speech_summary.get("words_per_minute"):
                speech_text = (f" You spoke at about {speech_summary['words_per_minute']} words per minute "
                               f"with {speech_summary['fillers_per_minute']} filler words per minute.")
            elif filler_summary["total_fillers"] > 0:
                speech_text = (f" Focus on reducing the {filler_summary['total_fillers']} filler words "
                               "used across the session.")
            else:
                speech_text = ""
            summary_feedback = (
                f"Overall score: {overall}/100. "
                f"Answer quality averaged {answer_quality}% and {camera_text}.{speech_text}"
            )
        if 0 < comp["answered"] < comp["total"]:
            summary_feedback += (
                f" You answered {comp['answered']} of {comp['total']} questions; the overall score is "
                f"scaled by your {comp['rate_percent']}% completion rate."
            )
        if ended_early:
            summary_feedback = (
                ("This interview ended because the candidate stayed outside it for more than "
                 f"{config.PROCTORING_MAX_AWAY_SECONDS} seconds; " if payload.end_reason == "away" else
                 "This interview ended early after repeated integrity violations; ")
                + "unanswered questions earn no credit. " + summary_feedback
            )
        if decision["verdict"] == "invalid":
            summary_feedback = (
                "This interview is invalid: the candidate's identity could not be confirmed "
                "throughout, so the overall score is 0. " + summary_feedback
            )
        elif decision["answers_zeroed"] or decision["answers_capped"]:
            summary_feedback = (
                "Some answers showed signs of malpractice and were penalised; see the Integrity "
                "section. " + summary_feedback
            )

        # Step E: Persist the report and close the interview.
        cur.execute(
            """
            INSERT INTO evaluation_reports (
                interview_id, answer_quality_score, communication_score,
                voice_confidence_score, speech_fluency_score, camera_engagement_score, overall_score,
                vision_metrics, nlp_metrics, strengths, improvements, summary_feedback,
                criteria_scores, speech_metrics, scoring_version, scoring_weights, integrity
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (
                interview_id, answer_quality, communication,
                fluency,  # voice_confidence_score: legacy column, mirrors fluency
                fluency, camera, overall,
                json.dumps(vision_metrics), json.dumps(filler_summary),
                top_strengths, top_improvements, summary_feedback,
                json.dumps(criteria) if criteria else None,
                json.dumps(speech_summary) if speech_summary else None,
                scoring.SCORING_VERSION, json.dumps(weights), json.dumps(integrity_summary),
            )
        )
        cur.execute(
            """
            UPDATE interviews
            SET status = 'completed',
                overall_score = %s,
                duration_seconds = %s,
                completed_at = NOW(),
                ended_early = %s,
                end_reason = %s,
                integrity_verdict = %s
            WHERE id = %s;
            """,
            (overall, payload.duration_seconds, ended_early,
             (payload.end_reason or "violations") if ended_early else None,
             decision["verdict"], interview_id)
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
        "criteria_scores": criteria, "speech_metrics": speech_summary,
        "vision_metrics": vision_metrics, "scoring_version": scoring.SCORING_VERSION,
        "scoring_weights": weights, "integrity": integrity_summary,
    }, comp)


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
        cur.execute(
            """SELECT event_type, question_index, recording_part, at_seconds, duration_seconds
               FROM proctoring_events WHERE interview_id = %s
               ORDER BY recording_part NULLS FIRST, at_seconds NULLS FIRST;""",
            (interview_id,),
        )
        events = [{**row, "label": integrity.LABELS.get(row["event_type"], row["event_type"]),
                   "major": row["event_type"] in integrity.MAJOR_EVENTS} for row in cur.fetchall()]
        cur.execute(
            """SELECT id, kind, question_index, recording_part, at_seconds, verdict, similarity, faces, image_name
               FROM identity_checks WHERE interview_id = %s AND verdict NOT IN ('match', 'unavailable')
               ORDER BY created_at LIMIT 60;""",
            (interview_id,),
        )
        flagged_checks = [{**row, "id": str(row["id"])} for row in cur.fetchall()]
        cur.execute("SELECT enrolled_at FROM identity_profiles WHERE interview_id = %s;", (interview_id,))
        profile = cur.fetchone()

    return {
        **completion_response(report, scoring.completion(turns, interview["max_turns"])),
        # Raw columns kept for older clients that read them directly.
        "answer_quality_score": report["answer_quality_score"],
        "communication_score": report["communication_score"],
        "summary_feedback": report["summary_feedback"],
        "created_at": report.get("created_at"),
        "role_title": interview["role_title"],
        "interview_mode": interview.get("interview_mode"),
        "answer_mode": interview.get("answer_mode") or "typed",
        "recording_parts": recording_parts(interview_id),
        "duration_seconds": interview.get("duration_seconds"),
        "turns": turns,
        "proctoring_events": events,
        "ended_early": bool(interview.get("ended_early")),
        "identity": {
            "enrolled": bool(profile),
            "photo": "enroll.jpg" if profile and os.path.isfile(
                os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)), "identity", "enroll.jpg")) else None,
            "flagged_checks": flagged_checks,
        },
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
            SELECT id, role_title, interview_mode, status, duration_seconds, overall_score, created_at, completed_at,
                   ended_early, integrity_verdict
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
# BLOCK 13b: GET /api/interviews/{id}/media/{n}  (answer playback)
# -------------------------------------------------------------
# Owner-only. Recordings are never served from a public path; the browser
# fetches this with the ID token and plays the result from a blob URL.
# FileResponse supports HTTP range requests, so seeking works.
MEDIA_FILE_PATTERN = re.compile(r"^q_\d+(_audio)?\.(webm|mp4|ogg|mp3|wav)$")
MEDIA_TYPES = {"webm": "video/webm", "mp4": "video/mp4", "ogg": "audio/ogg", "mp3": "audio/mpeg", "wav": "audio/wav"}


@app.get("/api/interviews/{interview_id}/media/{question_index}")
def get_answer_media(
    interview_id: str,
    question_index: int,
    kind: Literal["video", "audio"] = "video",
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not load this recording. Please retry.") as (_conn, cur):
        owned_interview(cur, interview_id, user, lock=False)
        cur.execute(
            """SELECT video_url, audio_path FROM interview_responses
               WHERE interview_id = %s AND question_index = %s;""",
            (interview_id, question_index),
        )
        row = cur.fetchone()

    stored = (row or {}).get("video_url" if kind == "video" else "audio_path")
    filename = os.path.basename(stored or "")
    if not MEDIA_FILE_PATTERN.match(filename):
        raise HTTPException(404, "No recording for this answer.")
    path = os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)), filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "No recording for this answer.")
    media_type = MEDIA_TYPES[filename.rsplit(".", 1)[1]]
    if kind == "audio" and media_type.startswith("video/"):
        media_type = media_type.replace("video/", "audio/")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "private, max-age=3600"})


# -------------------------------------------------------------
# BLOCK 13d: Whole-interview recording, uploaded in chunks
# -------------------------------------------------------------
# The browser records the entire interview and sends a chunk about every
# ten seconds, so a closed tab or crash loses at most a few seconds and no
# single huge upload is needed. A reload starts a new "part" (a recording
# cannot be continued after the page is gone). Chunks must arrive in order;
# a repeated chunk (client retry) is acknowledged without being re-appended.
_recording_lock = threading.Lock()
MAX_CHUNK_BYTES = 64 * 1024 * 1024


def _session_paths(interview_id: str, part: int, extension: Optional[str] = None):
    folder = os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)))
    meta = os.path.join(folder, f"session_{part}.json")
    media = os.path.join(folder, f"session_{part}.{extension}") if extension else None
    return folder, meta, media


def _read_session_meta(meta_path: str) -> Optional[dict]:
    try:
        with open(meta_path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def recording_parts(interview_id: str) -> list[int]:
    """Session-recording part numbers that exist on disk, ascending."""
    folder = os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)))
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    return sorted(int(m.group(1)) for n in names if (m := re.match(r"^session_(\d+)\.json$", n)))


@app.post("/api/interviews/{interview_id}/recording")
def upload_recording_chunk(
    interview_id: str,
    part: int = Form(..., ge=1, le=50),
    seq: int = Form(..., ge=0),
    chunk: UploadFile = File(...),
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not save the recording. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        if interview.get("interview_mode") == "game":
            raise HTTPException(409, "Arena sessions are not recorded.")

    content_type = (chunk.content_type or "").lower()
    if not content_type.startswith(("video/", "audio/")):
        raise HTTPException(415, "Upload a video recording chunk.")
    data = chunk.file.read(MAX_CHUNK_BYTES + 1)
    if len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(413, "Recording chunk is too large.")

    folder, meta_path, _ = _session_paths(interview_id, part)
    with _recording_lock:
        os.makedirs(folder, exist_ok=True)
        meta = _read_session_meta(meta_path) or {
            "next_seq": 0, "bytes": 0,
            "extension": media_filename(0, "video", content_type).rsplit(".", 1)[1],
        }
        if seq < meta["next_seq"]:
            return {"part": part, "next_seq": meta["next_seq"], "bytes": meta["bytes"], "duplicate": True}
        if seq > meta["next_seq"]:
            raise HTTPException(409, f"Expected chunk {meta['next_seq']} for part {part}.")
        if meta["bytes"] + len(data) > config.MAX_SESSION_RECORDING_MB * 1024 * 1024:
            raise HTTPException(413, f"The recording exceeds {config.MAX_SESSION_RECORDING_MB} MB.")
        _, _, media_path = _session_paths(interview_id, part, meta["extension"])
        with open(media_path, "ab") as handle:
            handle.write(data)
        meta.update(next_seq=seq + 1, bytes=meta["bytes"] + len(data))
        temporary = f"{meta_path}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(meta, handle)
        os.replace(temporary, meta_path)
    return {"part": part, "next_seq": meta["next_seq"], "bytes": meta["bytes"]}


@app.get("/api/interviews/{interview_id}/recording/{part}")
def get_session_recording(interview_id: str, part: int, user: AuthUser = Depends(auth.current_user)):
    """Owner-only playback of one part of the whole-interview recording."""
    with transaction("Could not load this recording. Please retry.") as (_conn, cur):
        owned_interview(cur, interview_id, user, lock=False)
    _, meta_path, _ = _session_paths(interview_id, part)
    meta = _read_session_meta(meta_path)
    if not meta:
        raise HTTPException(404, "No recording for this interview.")
    _, _, media_path = _session_paths(interview_id, part, meta["extension"])
    if not os.path.isfile(media_path):
        raise HTTPException(404, "No recording for this interview.")
    return FileResponse(media_path, media_type=MEDIA_TYPES.get(meta["extension"], "video/webm"),
                        headers={"Cache-Control": "private, max-age=3600"})


# -------------------------------------------------------------
# BLOCK 13f: POST /api/interviews/{id}/proctoring  (integrity events)
# -------------------------------------------------------------
# The browser sends integrity events as they happen (and again on retry);
# client_event_id makes repeats harmless. Only active Standard interviews.
@app.post("/api/interviews/{interview_id}/proctoring")
def record_proctoring_events(interview_id: str, payload: ProctoringBatch,
                             user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not record the integrity event. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        adaptive_service.require_active(interview)
        stored = 0
        for event in payload.events:
            if event.type not in integrity.CLIENT_EVENT_TYPES:
                continue
            cur.execute(
                """INSERT INTO proctoring_events
                   (interview_id, client_event_id, event_type, question_index, recording_part,
                    at_seconds, duration_seconds, details)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (interview_id, client_event_id) DO UPDATE
                   SET duration_seconds = COALESCE(EXCLUDED.duration_seconds, proctoring_events.duration_seconds);""",
                (interview_id, event.id, event.type, event.question_index, event.part,
                 event.at, event.duration, json.dumps(event.details)[:2000]),
            )
            stored += 1
        cur.execute(
            "SELECT event_type, duration_seconds FROM proctoring_events WHERE interview_id = %s;",
            (interview_id,),
        )
        summary = integrity.summarize(cur.fetchall())
    return {"stored": stored, "violations": summary["violations"],
            "max_violations": config.PROCTORING_MAX_VIOLATIONS}


# -------------------------------------------------------------
# BLOCK 13g: Identity verification (enrolment + face snapshots)
# -------------------------------------------------------------
# Enrolment (once, before the first question): one photo and a sentence
# read aloud. Afterwards the browser sends a face snapshot every ~20 s and
# whenever the camera picture changes; each is compared with the enrolled
# face. Two mismatches in a row are a confirmed "different person" event.
# Images are kept only as evidence (the enrolment photo and snapshots that
# did not match) and are served to the owner only.
MAX_IMAGE_BYTES = 2 * 1024 * 1024
IDENTITY_IMAGE_PATTERN = re.compile(r"^(enroll|check_[0-9a-f-]{36})\.jpg$")
SNAPSHOT_MIN_INTERVAL_SECONDS = 4.0
_snapshot_times: dict[str, float] = {}
_snapshot_lock = threading.Lock()


def _identity_folder(interview_id: str) -> str:
    folder = os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)), "identity")
    os.makedirs(folder, exist_ok=True)
    return folder


def _read_image(upload: UploadFile) -> bytes:
    if not (upload.content_type or "").lower().startswith("image/"):
        raise HTTPException(415, "Upload a JPEG or PNG image.")
    data = upload.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is too large.")
    return data


def _proctored_interview(cur, interview_id: str, user: AuthUser):
    interview = owned_interview(cur, interview_id, user, lock=False)
    adaptive_service.require_active(interview)
    return interview


ENROLMENT_FACE_MESSAGES = {
    "no_face": "We could not see your face. Sit facing the camera in good light and try again.",
    "multiple_faces": "More than one face is visible. Only you should be in view; try again.",
    "unclear": "Your face is too small, dark or blurred. Move closer to the camera in good light and try again.",
}


@app.post("/api/interviews/{interview_id}/identity/enroll")
def enroll_identity(
    interview_id: str,
    photo: UploadFile = File(...),
    audio: Optional[UploadFile] = File(None),
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not prepare the identity check. Please retry.") as (_conn, cur):
        _proctored_interview(cur, interview_id, user)
        cur.execute("SELECT 1 FROM interview_responses WHERE interview_id = %s LIMIT 1;", (interview_id,))
        if cur.fetchone():
            raise HTTPException(409, "Identity can only be enrolled before the first answer.")
    if not identity.enabled():
        return {"available": False, "face": False, "voice": False, "enrolled": False}

    image = identity.decode_image(_read_image(photo))
    if image is None:
        raise HTTPException(422, "The photo could not be read. Please try again.")
    face_gallery, voice_gallery, voice_seconds = [], [], None
    available = identity.status()
    if available["face"]:
        analysis = identity.analyze_face(image)
        verdict = ("no_face" if analysis["faces"] == 0 else "multiple_faces" if analysis["faces"] > 1
                   else None if analysis["quality_ok"] else "unclear")
        if verdict:
            raise HTTPException(422, ENROLMENT_FACE_MESSAGES[verdict])
        face_gallery = [analysis["embedding"]]
    if available["voice"] and audio is not None and audio.filename:
        path = os.path.join(_identity_folder(interview_id), "enroll_audio.webm")
        with open(path, "wb") as handle:
            handle.write(audio.file.read(10 * 1024 * 1024))
        try:
            voice = identity.enrol_voice(path)
        except Exception:
            logger.exception("Voice enrolment failed")
            voice = {"embedding": None, "speech_seconds": 0}
        finally:
            os.remove(path)
        if voice["embedding"] is None:
            raise HTTPException(422, "We could not hear enough of your voice. Read the sentence again, clearly.")
        voice_gallery, voice_seconds = [voice["embedding"]], voice["speech_seconds"]

    if face_gallery:
        identity.save_jpeg(image, os.path.join(_identity_folder(interview_id), "enroll.jpg"))
    with transaction("Could not save the identity check. Please retry.") as (_conn, cur):
        cur.execute(
            """INSERT INTO identity_profiles (interview_id, voice_embeddings, face_embeddings, voice_seconds)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (interview_id) DO UPDATE SET
                 voice_embeddings = EXCLUDED.voice_embeddings, face_embeddings = EXCLUDED.face_embeddings,
                 voice_seconds = EXCLUDED.voice_seconds, enrolled_at = NOW();""",
            (interview_id, json.dumps(voice_gallery), json.dumps(face_gallery), voice_seconds),
        )
    return {"available": True, "face": bool(face_gallery), "voice": bool(voice_gallery), "enrolled": True}


@app.post("/api/interviews/{interview_id}/identity/snapshot")
def identity_snapshot(
    interview_id: str,
    photo: UploadFile = File(...),
    question_index: Optional[int] = Form(None, ge=1, le=50),
    part: Optional[int] = Form(None, ge=1, le=50),
    at: Optional[float] = Form(None, ge=0, le=24 * 60 * 60),
    user: AuthUser = Depends(auth.current_user),
):
    with transaction("Could not check the camera image. Please retry.") as (_conn, cur):
        _proctored_interview(cur, interview_id, user)
        cur.execute("SELECT face_embeddings FROM identity_profiles WHERE interview_id = %s;", (interview_id,))
        profile = cur.fetchone()
    if not profile or not profile["face_embeddings"] or not identity.enabled():
        return {"verdict": "unavailable", "event": None}

    key = str(uuid.UUID(interview_id))
    with _snapshot_lock:
        now = time.monotonic()
        if now - _snapshot_times.get(key, 0.0) < SNAPSHOT_MIN_INTERVAL_SECONDS:
            raise HTTPException(429, "Snapshots are too frequent.")
        _snapshot_times[key] = now

    image = identity.decode_image(_read_image(photo))
    if image is None:
        raise HTTPException(422, "The image could not be read.")
    try:
        check = identity.check_face(image, list(profile["face_embeddings"]))
    except identity.IdentityUnavailable:
        return {"verdict": "unavailable", "event": None}
    embedding = check.pop("embedding", None)

    with transaction("Could not save the camera check. Please retry.") as (_conn, cur):
        cur.execute("SELECT face_embeddings FROM identity_profiles WHERE interview_id = %s FOR UPDATE;",
                    (interview_id,))
        gallery = list(cur.fetchone()["face_embeddings"] or [])
        cur.execute(
            """SELECT verdict, details FROM identity_checks WHERE interview_id = %s AND kind = 'face'
               ORDER BY created_at DESC LIMIT 1;""",
            (interview_id,),
        )
        previous = cur.fetchone()
        streak = 1
        if previous and previous["verdict"] == check["verdict"]:
            streak = int((previous["details"] or {}).get("streak", 1)) + 1
        check["streak"] = streak

        check_id = str(uuid.uuid4())
        image_name = None
        if check["verdict"] not in ("match", "unavailable"):
            image_name = f"check_{check_id}.jpg"
            identity.save_jpeg(image, os.path.join(_identity_folder(interview_id), image_name))
        cur.execute(
            """INSERT INTO identity_checks
               (id, interview_id, kind, question_index, recording_part, at_seconds, verdict,
                similarity, faces, image_name, details)
               VALUES (%s, %s, 'face', %s, %s, %s, %s, %s, %s, %s, %s);""",
            (check_id, interview_id, question_index, part, at, check["verdict"], check.get("similarity"),
             check.get("faces"), image_name, json.dumps(check)),
        )

        # Two in a row confirms it; one event per streak.
        event = None
        if streak == 2 and check["verdict"] in ("mismatch", "multiple_faces"):
            event = "face_mismatch" if check["verdict"] == "mismatch" else "extra_person"
            _server_event(cur, interview_id, f"face-{check_id}", event, question_index,
                          {"similarity": check.get("similarity"), "faces": check.get("faces"),
                           "image": image_name})
            cur.execute("UPDATE proctoring_events SET recording_part = %s, at_seconds = %s "
                        "WHERE interview_id = %s AND client_event_id = %s;",
                        (part, at, interview_id, f"face-{check_id}"))
        elif check["verdict"] == "match":
            grown = identity.grow_gallery(gallery, embedding, check.get("similarity"),
                                          identity.FACE_GALLERY_ADD_SIMILARITY)
            if len(grown) != len(gallery):
                cur.execute("UPDATE identity_profiles SET face_embeddings = %s WHERE interview_id = %s;",
                            (json.dumps(grown), interview_id))
        violations = _violation_count(cur, interview_id)

    return {
        "verdict": check["verdict"], "similarity": check.get("similarity"), "faces": check.get("faces"),
        "event": {"type": event, "label": integrity.LABELS[event]} if event else None,
        "violations": violations, "max_violations": config.PROCTORING_MAX_VIOLATIONS,
    }


@app.get("/api/interviews/{interview_id}/identity/images/{name}")
def identity_image(interview_id: str, name: str, user: AuthUser = Depends(auth.current_user)):
    """Owner-only enrolment photo or flagged snapshot."""
    if not IDENTITY_IMAGE_PATTERN.match(name):
        raise HTTPException(404, "Image not found.")
    with transaction("Could not load this image. Please retry.") as (_conn, cur):
        owned_interview(cur, interview_id, user, lock=False)
    path = os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)), "identity", name)
    if not os.path.isfile(path):
        raise HTTPException(404, "Image not found.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


# -------------------------------------------------------------
# BLOCK 13h: Coding round (VPL)
# -------------------------------------------------------------
# Run: the visible examples (and optionally the candidate's own input) with
# their expected output. Submit: every test, visible and hidden, then the AI
# code review; stored like any other answer, then /next-question as usual.
# Code never runs while a database transaction is open.
class CodeRequest(BaseModel):
    question_index: int = Field(ge=1, le=50)
    language: Literal["python", "javascript", "cpp", "java"]
    code: str = Field(max_length=code_runner.MAX_CODE_BYTES)
    custom_input: Optional[str] = Field(default=None, max_length=20000)
    answer_signals: Optional[dict] = None


MAX_RUNS_PER_QUESTION = 40
RUN_MIN_INTERVAL_SECONDS = 1.5
_runs: dict[tuple, list] = {}
_runs_lock = threading.Lock()


def _coding_question(cur, interview_id: str, question_index: int, user: AuthUser):
    interview = owned_interview(cur, interview_id, user, lock=False)
    question = adaptive_service.question_for_submission(cur, interview, question_index)
    if question.get("kind") != "coding" or not question.get("coding_private"):
        raise HTTPException(409, "This question is not a coding question.")
    return interview, question


@app.get("/api/coding/languages")
def coding_languages(user: AuthUser = Depends(auth.current_user)):
    return code_runner.available_languages()


@app.post("/api/interviews/{interview_id}/code/run")
def run_code(interview_id: str, payload: CodeRequest, user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not run the code. Please retry.") as (_conn, cur):
        _interview, question = _coding_question(cur, interview_id, payload.question_index, user)
    key = (str(uuid.UUID(interview_id)), payload.question_index)
    with _runs_lock:
        history = _runs.setdefault(key, [0, 0.0])
        if time.monotonic() - history[1] < RUN_MIN_INTERVAL_SECONDS:
            raise HTTPException(429, "Wait a moment before running again.")
        if history[0] >= MAX_RUNS_PER_QUESTION:
            raise HTTPException(429, "Run limit reached for this question; submit your solution.")
        history[0] += 1
        history[1] = time.monotonic()

    tests = coding.examples_for(question["coding"])
    if payload.custom_input is not None:
        tests.append({"input": payload.custom_input,
                      "expected": coding.custom_expected(question["coding_private"], payload.custom_input)})
    try:
        run = code_runner.run_tests(payload.language, payload.code, tests)
    except code_runner.RunnerError as err:
        raise HTTPException(503 if "unavailable" in str(err) else 422, str(err))
    results = [{**result, "input": test["input"], "expected": test["expected"],
                "custom": index >= len(question["coding"].get("examples") or [])}
               for index, (test, result) in enumerate(zip(tests, run["results"]))]
    return {"compiled": run["compiled"], "compile_output": run["compile_output"], "results": results,
            "runs_left": MAX_RUNS_PER_QUESTION - _runs[key][0]}


@app.post("/api/interviews/{interview_id}/code/submit")
def submit_code(interview_id: str, payload: CodeRequest, user: AuthUser = Depends(auth.current_user)):
    # Step A: validate without holding a lock; replay an accepted submission.
    with transaction("Could not submit the code. Please retry.") as (_conn, cur):
        cur.execute("SELECT * FROM interview_questions WHERE interview_id = %s AND question_index = %s;",
                    (interview_id, payload.question_index))
        existing_question = cur.fetchone()
        owned_interview(cur, interview_id, user, lock=False)
        if existing_question:
            previous = adaptive_service.existing_submission(cur, existing_question)
            if previous:
                return {**adaptive_service.submission_result(previous), "coding": _public_coding(previous)}
        _interview, question = _coding_question(cur, interview_id, payload.question_index, user)

    # Step B: run every test and review the code (no database work).
    tests = coding.tests_for(question["coding_private"])
    try:
        run = code_runner.run_tests(payload.language, payload.code, tests)
    except code_runner.RunnerError as err:
        raise HTTPException(503 if "unavailable" in str(err) else 422, str(err))
    evaluation = coding.grade({**question["coding"]}, payload.language, payload.code, run,
                              len(question["coding"].get("examples") or []))

    # Step C: store under the interview lock (a concurrent retry wins once).
    with transaction("Could not save the coding answer. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user)
        question = adaptive_service.question_for_submission(cur, interview, payload.question_index)
        previous = adaptive_service.existing_submission(cur, question)
        if previous:
            return {**adaptive_service.submission_result(previous), "coding": _public_coding(previous)}
        answer = f"[{payload.language}]\n{payload.code}"
        response = adaptive_service.insert_response(
            cur, interview, question, answer, evaluation,
            fillers=nlp_evaluator.count_filler_words(""), answer_signals=malpractice.sanitize_signals(payload.answer_signals),
        )
        return {**adaptive_service.submission_result(response), "coding": _public_coding(response)}


def _public_coding(response) -> dict:
    """Test counts shown after a submission (no hidden inputs or outputs)."""
    result = response.get("coding_result") or {}
    return {key: result.get(key) for key in ("passed", "total", "compiled", "examples_passed",
                                              "hidden_passed", "language")}


# -------------------------------------------------------------
# BLOCK 13i: Arena ranking
# -------------------------------------------------------------
class ArenaEndRequest(BaseModel):
    reason: Literal["away", "violations"]


@app.post("/api/interviews/{interview_id}/arena-end")
def arena_end(interview_id: str, payload: ArenaEndRequest, user: AuthUser = Depends(auth.current_user)):
    """End a ranked Arena early: unplayed levels score 0 and the rating drops."""
    with transaction("Could not end the Arena. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user)
        arena.require_game(interview)
        if interview["status"] == "in_progress":
            arena.finalize(cur, interview, end_reason=payload.reason)
            interview = owned_interview(cur, interview_id, user)
        return arena.results(cur, interview)


@app.get("/api/arena/leaderboard")
def arena_leaderboard(category: str = ranking.OVERALL, limit: int = 50,
                      user: AuthUser = Depends(auth.current_user)):
    if category != ranking.OVERALL and category not in ranking.CATEGORIES:
        raise HTTPException(404, "Unknown category.")
    limit = max(1, min(limit, 100))
    with transaction("Could not load the leaderboard. Please retry.") as (_conn, cur):
        rows = ranking.leaderboard(cur, category, limit)
        cur.execute("SELECT id FROM users WHERE firebase_uid = %s;", (user.uid,))
        me = cur.fetchone()
        standing = ranking.rank(cur, me["id"], category) if me else {"rank": None, "total": 0, "rating": None}
    return {
        "category": category,
        "categories": [{"id": key, "label": label} for key, label in ranking.LABELS.items()],
        "rows": [{"rank": row["rank"], "name": ranking.display_name(row), "rating": row["rating"],
                  "games": row["games"], "best_rating": row["best_rating"],
                  "is_me": row["firebase_uid"] == user.uid} for row in rows],
        "me": standing,
    }


@app.get("/api/arena/me")
def arena_me(user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not load your ranking. Please retry.") as (_conn, cur):
        cur.execute("SELECT id FROM users WHERE firebase_uid = %s;", (user.uid,))
        me = cur.fetchone()
        if not me:
            return {"ratings": [], "recent": []}
        cur.execute("SELECT category, rating, games, best_rating FROM user_ratings WHERE user_id = %s;", (me["id"],))
        ratings = []
        for row in cur.fetchall():
            standing = ranking.rank(cur, me["id"], row["category"])
            ratings.append({**row, "label": ranking.LABELS.get(row["category"], row["category"]),
                            "rank": standing["rank"], "total": standing["total"]})
        ratings.sort(key=lambda r: (r["category"] != ranking.OVERALL, r["label"]))
        cur.execute(
            """SELECT e.category, e.change, e.rating_after, e.details, e.created_at, e.interview_id, i.role_title
               FROM rating_events e LEFT JOIN interviews i ON i.id = e.interview_id
               WHERE e.user_id = %s ORDER BY e.created_at DESC LIMIT 20;""",
            (me["id"],),
        )
        recent = [{**row, "interview_id": str(row["interview_id"]) if row["interview_id"] else None,
                   "label": ranking.LABELS.get(row["category"], row["category"])} for row in cur.fetchall()]
    return {"ratings": ratings, "recent": recent}


# -------------------------------------------------------------
# BLOCK 13e: Spoken interviewer (Piper text-to-speech)
# -------------------------------------------------------------
# GET /api/interviews/{id}/speech/{item}   item: intro | outro | question-<n>
# GET /api/speech/{phrase}                 fixed phrases (speaker test, thanks…)
# Text is always built on the server (questions come from the database), so
# the endpoints cannot be used to synthesise arbitrary text. 503 means the
# browser should fall back to its own speech synthesis.
def _speech_response(text: str):
    try:
        path = tts_service.synthesize(text)
    except tts_service.SpeechUnavailable as err:
        raise HTTPException(503, str(err))
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"})


def _first_name(user: AuthUser) -> Optional[str]:
    first = (user.name or "").strip().split(" ")[0]
    first = "".join(ch for ch in first if ch.isalpha() or ch in "-'")
    return first[:30] or None


@app.get("/api/interviews/{interview_id}/speech/{item}")
def interview_speech(interview_id: str, item: str, user: AuthUser = Depends(auth.current_user)):
    match = re.fullmatch(r"question-(\d{1,2})", item)
    with transaction("Could not prepare the spoken question. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        if item == "intro":
            text = tts_service.intro_text(_first_name(user), interview["role_title"], interview["max_turns"])
        elif item == "outro":
            text = tts_service.outro_text()
        elif match and 1 <= int(match.group(1)) <= interview["current_turn"]:
            cur.execute(
                """SELECT question_text, is_follow_up FROM interview_questions
                   WHERE interview_id = %s AND question_index = %s;""",
                (interview_id, int(match.group(1))),
            )
            question = cur.fetchone()
            if not question:
                raise HTTPException(404, "Question not found.")
            text = tts_service.question_text(int(match.group(1)), question["question_text"],
                                             bool(question.get("is_follow_up")))
        else:
            raise HTTPException(404, "Unknown speech item.")
    return _speech_response(text)


@app.get("/api/speech/{phrase}")
def speech_phrase(phrase: str, user: AuthUser = Depends(auth.current_user)):
    text = tts_service.PHRASES.get(phrase)
    if not text:
        raise HTTPException(404, "Unknown phrase.")
    return _speech_response(text)


# -------------------------------------------------------------
# BLOCK 13c: GET /api/interviews/{id}/state  (resume after refresh)
# -------------------------------------------------------------
# Lets the interview page continue an active Standard interview after a
# reload instead of starting a new session.
#   status          in_progress | completed | evaluated
#   question        the current public question (no rubric)
#   answered        candidate-visible results of earlier turns
#   pending_response_id  set when the current answer was accepted but the
#                   next question was not yet issued (retry next-question)
#   awaiting_completion  every turn answered; call /complete next
@app.get("/api/interviews/{interview_id}/state")
def get_interview_state(interview_id: str, user: AuthUser = Depends(auth.current_user)):
    with transaction("Could not load this interview. Please retry.") as (_conn, cur):
        interview = owned_interview(cur, interview_id, user, lock=False)
        cur.execute(
            "SELECT * FROM interview_questions WHERE interview_id = %s AND question_index = %s;",
            (interview_id, interview["current_turn"]),
        )
        question = cur.fetchone()
        cur.execute(
            """SELECT id, question_index, question_text, difficulty, is_follow_up, topic,
                      candidate_answer, answer_quality_score, communication_score, criteria_scores,
                      strengths, improvements, feedback, missing_concepts, evaluation_source, next_result
               FROM interview_responses WHERE interview_id = %s ORDER BY question_index;""",
            (interview_id,),
        )
        responses = cur.fetchall()

        cur.execute(
            "SELECT event_type, duration_seconds FROM proctoring_events WHERE interview_id = %s;",
            (interview_id,),
        )
        violations = integrity.summarize(cur.fetchall())["violations"]
        cur.execute("SELECT 1 FROM identity_profiles WHERE interview_id = %s;", (interview_id,))
        enrolled = cur.fetchone() is not None

    current = next((r for r in responses if r["question_index"] == interview["current_turn"]), None)
    final_turn = interview["current_turn"] >= interview["max_turns"]
    answered = [{
        "index": r["question_index"], "question": r["question_text"], "difficulty": r["difficulty"],
        "is_follow_up": bool(r["is_follow_up"]), "topic": r["topic"], "answer": r["candidate_answer"],
        "response_id": str(r["id"]), "completed": True,
        "evaluation": adaptive_service.public_evaluation(r),
        "adaptation": (r.get("next_result") or {}).get("adaptation"),
    } for r in responses]
    return {
        "interview_id": str(interview["id"]),
        "status": interview["status"],
        "interview_mode": interview.get("interview_mode"),
        "role_title": interview["role_title"],
        "current_turn": interview["current_turn"],
        "max_turns": interview["max_turns"],
        "question": adaptive_service.public_question(question) if question else None,
        "answered": answered,
        "pending_response_id": str(current["id"]) if current and current.get("next_result") is None else None,
        "awaiting_completion": bool(current and final_turn and current.get("next_result") is not None),
        "answer_mode": interview.get("answer_mode") or "typed",
        "recording_parts": recording_parts(interview_id),
        "proctoring": {
            "max_violations": config.PROCTORING_MAX_VIOLATIONS,
            "max_away_seconds": config.PROCTORING_MAX_AWAY_SECONDS,
            "violations": violations,
        },
        "coding_round": bool(interview.get("coding_round")),
        "identity": {"enabled": identity.enabled(), "enrolled": enrolled},
    }


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
                   r.criteria_scores, r.speech_metrics,
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
        "speech_to_text": {
            "provider": config.STT_PROVIDER,
            "model": config.STT_MODEL if config.STT_PROVIDER == "whisper" else None,
            "loaded": stt_service.is_loaded(),
        },
        "text_to_speech": {
            "provider": config.TTS_PROVIDER,
            "voice": config.PIPER_VOICE if config.TTS_PROVIDER == "piper" else None,
            "loaded": tts_service.is_loaded(),
        },
        # Which identity checks this server can run (voice, face).
        "identity": identity.status(),
        "coding_languages": [item["id"] for item in code_runner.available_languages()],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=True)
