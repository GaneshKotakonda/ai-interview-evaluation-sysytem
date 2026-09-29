import os
import shutil
import uuid
import json
from typing import Literal, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Ensure .env is loaded from backend directory
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
load_dotenv()

import database
import gemini_service
import nlp_evaluator
import adaptive_service
import arena

# -------------------------------------------------------------
# BLOCK 1: FastAPI Application Initialization & CORS
# -------------------------------------------------------------
# We create the FastAPI instance and enable Cross-Origin Resource
# Sharing (CORS). This is essential because the React frontend runs
# on http://localhost:5173, while this FastAPI backend runs on
# http://localhost:8000. Without CORS, the browser blocks requests.
app = FastAPI(
    title="AI Interview Evaluation API",
    description="Backend service for question generation, vector RAG evaluation, and video storage",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------
# BLOCK 2: Media Storage Directory & Static Serving
# -------------------------------------------------------------
# We create an 'uploads' directory to store candidate video/audio files (.webm).
# app.mount makes the files publicly accessible via URLs like:
# http://localhost:8000/uploads/interview_id/q_1.webm
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# -------------------------------------------------------------
# BLOCK 3: Server Startup Event
# -------------------------------------------------------------
# When the server starts up, this event verifies that PostgreSQL is running.
@app.on_event("startup")
def on_startup():
    print("--- [SERVER STARTING] Checking PostgreSQL connection ---")
    database.test_db_connection()


# -------------------------------------------------------------
# BLOCK 4: Request Models (Pydantic)
# -------------------------------------------------------------
# Pydantic validates incoming JSON request payloads.
class StartInterviewRequest(BaseModel):
    firebase_uid: Optional[str] = None
    email: Optional[str] = None
    full_name: Optional[str] = None
    # Kept as a compatibility alias for older frontend builds.
    user_id: Optional[str] = None
    role_title: str = "Software Engineer"
    job_description: Optional[str] = None
    interview_mode: Literal["standard", "game"] = "standard"
    max_turns: int = Field(default=5, ge=1, le=20)

class HintRequest(BaseModel):
    current_turn: int = Field(ge=1, le=6)


class NextQuestionRequest(BaseModel):
    # Optional token makes retries unambiguous even after another answer arrives.
    response_id: Optional[uuid.UUID] = None

class EvaluateInterviewRequest(BaseModel):
    vision_metrics: Optional[dict] = None  # Received from Harsha's BehaviorMonitor.jsx
    duration_seconds: int = Field(default=0, ge=0)


def completion_response(report):
    """Stable completion contract for initial submission and retry."""
    speech_fluency = report.get("speech_fluency_score")
    if speech_fluency is None:
        speech_fluency = report.get("voice_confidence_score")
    return {
        "interview_id": str(report["interview_id"]),
        "overall_score": report["overall_score"],
        "scores": [
            {"label": "Answer Quality", "value": report["answer_quality_score"]},
            {"label": "Communication", "value": report["communication_score"]},
            {"label": "Speech Fluency", "value": speech_fluency},
            {"label": "Camera Engagement", "value": report["camera_engagement_score"]},
        ],
        "speech_fluency_score": speech_fluency,
        "strengths": report["strengths"], "improvements": report["improvements"],
        "feedback": report["summary_feedback"], "nlp_metrics": report["nlp_metrics"],
    }


# -------------------------------------------------------------
# BLOCK 5: Endpoint - Start Interview & Generate Questions with Gemini
# -------------------------------------------------------------
# 1. Inserts a new row in 'interviews' table with role title and optional Job Description.
# 2. Generates only the initial medium question and its private rubric.
# 3. Vectorizes each rubric point using the existing embedding service.
# 4. Saves the rubric points and embeddings into 'question_rubrics' in PostgreSQL.
# 5. Returns the first public question and adaptive turn metadata.
@app.post("/api/interviews/start")
def start_interview(payload: StartInterviewRequest):
    firebase_uid = (payload.firebase_uid or payload.user_id or "").strip()
    if not firebase_uid:
        raise HTTPException(status_code=400, detail="firebase_uid is required.")

    max_turns = 6 if payload.interview_mode == "game" else payload.max_turns
    email = payload.email.strip() if payload.email and payload.email.strip() else None
    full_name = payload.full_name.strip() if payload.full_name and payload.full_name.strip() else None

    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            # Step A: Resolve the external Firebase identity to the internal UUID.
            cur.execute("SELECT id FROM users WHERE firebase_uid = %s;", (firebase_uid,))
            user_row = cur.fetchone()

            if user_row:
                valid_user_id = str(user_row["id"])
                cur.execute(
                    """
                    UPDATE users
                    SET email = COALESCE(%s, email),
                        full_name = COALESCE(%s, full_name)
                    WHERE id = %s;
                    """,
                    (email, full_name, valid_user_id)
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
                valid_user_id = str(cur.fetchone()["id"])

            # Create interview session with target role and optional job description
            cur.execute(
                """
                INSERT INTO interviews (user_id, role_title, job_description, status, max_turns, interview_mode)
                VALUES (%s, %s, %s, 'in_progress', %s, %s)
                RETURNING id;
                """,
                (valid_user_id, payload.role_title, payload.job_description, max_turns, payload.interview_mode)
            )
            interview_id = str(cur.fetchone()["id"])

            content = gemini_service.generate_adaptive_question(
                role_title=payload.role_title,
                job_description=(payload.job_description or "")[:4000],
                current_difficulty="medium", is_follow_up=False,
                recent_history=[], turn_number=1, max_turns=max_turns,
            )
            question = adaptive_service.public_question(
                adaptive_service.store_question(cur, interview_id, 1, content)
            )
            if payload.interview_mode == "game":
                arena.initialize(cur, interview_id)
            conn.commit()
            return {
                "interview_id": interview_id,
                "role_title": payload.role_title,
                "job_description": payload.job_description,
                "interview_mode": payload.interview_mode,
                "current_turn": 1, "current_difficulty": "medium",
                "max_turns": max_turns, "question": question,
                # Shape compatibility only: one turn, never a pre-generated set.
                "questions": [question],
            }
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Could not start the interview. Please retry.")
    finally:
        conn.close()


# -------------------------------------------------------------
# BLOCK 6: Endpoint - Submit Question Response & Save Video
# -------------------------------------------------------------
# Called by Interview.jsx when the candidate moves to the next question.
# 1. Accepts question index, question text, candidate text, and the video file (.webm).
# 2. Writes the video file to disk in uploads/{interview_id}/q_{index}.webm.
# 3. Vectorizes the candidate's answer using Gemini text-embedding-004.
# 4. Runs Cosine Similarity in PostgreSQL against the question's rubric points.
# 5. Saves the response, embedding, and video path in 'interview_responses'.
@app.post("/api/interviews/{interview_id}/submit-answer")
def submit_answer(
    interview_id: str,
    question_index: int = Form(...),
    question_text: str = Form(...),
    candidate_answer: str = Form(""),
    video: Optional[UploadFile] = File(None)
):
    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            interview = adaptive_service.lock_interview(cur, interview_id)
            adaptive_service.require_active(interview)
            # Find a previously accepted submission before checking current_turn,
            # so a retry after advancement cannot overwrite its answer or video.
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
            question = adaptive_service.question_for_submission(cur, interview, question_index)
            # Client question_text is retained for compatibility but never trusted
            # for evaluation. Grade only the question issued by the server.
            video_url = None
            if video and video.filename:
                interview_folder = os.path.join(UPLOAD_DIR, str(uuid.UUID(interview_id)))
                os.makedirs(interview_folder, exist_ok=True)
                video_filename = f"q_{question_index}.webm"
                with open(os.path.join(interview_folder, video_filename), "wb") as buffer:
                    shutil.copyfileobj(video.file, buffer)
                video_url = f"/uploads/{interview_id}/{video_filename}"
            response = adaptive_service.evaluate_and_store(
                conn, cur, interview, question, candidate_answer, video_url,
            )
            conn.commit()
            return adaptive_service.submission_result(response)
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(500, "Could not save and evaluate this answer. Please retry.")
    finally:
        conn.close()


@app.post("/api/interviews/{interview_id}/hint")
def arena_hint(interview_id: str, payload: HintRequest):
    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            interview = adaptive_service.lock_interview(cur, interview_id)
            result = arena.use_hint(cur, interview, payload.current_turn)
            conn.commit()
            return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(500, 'Could not request a hint. Please retry.')
    finally:
        conn.close()


@app.get("/api/interviews/{interview_id}/arena-results")
def arena_results(interview_id: str):
    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            interview = adaptive_service.lock_interview(cur, interview_id)
            return arena.results(cur, interview)
    finally:
        conn.close()


@app.post("/api/interviews/{interview_id}/next-question")
def next_question(interview_id: str, payload: Optional[NextQuestionRequest] = None):
    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            interview = adaptive_service.lock_interview(cur, interview_id)
            result = adaptive_service.advance(cur, interview, payload.response_id if payload else None)
            conn.commit()
            return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(500, "Could not advance the interview. Please retry.")
    finally:
        conn.close()


# -------------------------------------------------------------
# BLOCK 7: Endpoint - Complete Interview & Aggregate Saved Evaluations
# -------------------------------------------------------------
# Called when the candidate finishes the interview.
# 1. Fetches all candidate responses from 'interview_responses'.
# 2. Reuses immediate evaluations; only pre-migration answers need batch evaluation.
# 3. Combines Answer Quality + Communication (filler analysis) + Harsha's Vision metrics.
# 4. Computes the overall score and saves the report into 'evaluation_reports'.
# 5. Returns the complete structured report.
@app.post("/api/interviews/{interview_id}/complete")
def complete_and_evaluate_interview(interview_id: str, payload: EvaluateInterviewRequest):
    try:
        uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid interview_id UUID format.")

    conn = database.get_db_connection()
    try:
        # Step A: Fetch all candidate responses and interview JD for this interview
        with conn.cursor() as cur:
            intv_row = adaptive_service.lock_interview(cur, interview_id)
            if intv_row.get("interview_mode") == "game":
                raise HTTPException(409, "Arena completes through next-question; use arena-results for its summary.")
            if intv_row["status"] in ("completed", "evaluated"):
                cur.execute("SELECT * FROM evaluation_reports WHERE interview_id = %s;", (interview_id,))
                report = cur.fetchone()
                if report:
                    return completion_response(report)
            adaptive_service.require_active(intv_row)
            saved_jd = intv_row["job_description"]
            saved_role = intv_row["role_title"]

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
            len(adaptive_responses) != intv_row["max_turns"]
            or any(r["evaluated_at"] is None for r in adaptive_responses)
        ):
            raise HTTPException(409, "Answer all configured turns before completing this interview.")

        # Step B: Aggregate NLP metrics; prepare only legacy answers for evaluation.
        evaluation_items = []
        nlp_filler_summary = {"total_fillers": 0, "breakdown": {}}

        for item in responses:
            q_idx = item["question_index"]
            q_text = item["question_text"]
            ans_text = item["candidate_answer"] or ""
            sim_score = float(item["semantic_similarity_score"] or 0.0)

            # 1. Count filler words
            filler_result = nlp_evaluator.count_filler_words(ans_text)
            nlp_filler_summary["total_fillers"] += filler_result["total_count"]
            for word, count in filler_result["breakdown"].items():
                nlp_filler_summary["breakdown"][word] = nlp_filler_summary["breakdown"].get(word, 0) + count

            # Adaptive answers were already evaluated at submission.
            if item.get("question_id"):
                continue

            # Compatibility only: pre-migration responses have no saved evaluation.
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT ideal_concept_chunk FROM question_rubrics
                    WHERE interview_id = %s AND question_index = %s;
                    """,
                    (interview_id, q_idx)
                )
                rubric_rows = cur.fetchall()
                rubric_points = [r["ideal_concept_chunk"] for r in rubric_rows]

            evaluation_items.append({
                "question_index": q_idx,
                "question_text": q_text,
                "candidate_answer": ans_text,
                "rubric_points": rubric_points,
                "similarity_score": sim_score,
                "filler_count": filler_result["total_count"]
            })

        # Step B.2: Reuse scores already persisted by adaptive answer submission.
        if adaptive_responses:
            batch_eval_result = {
                "question_evaluations": adaptive_responses,
                "overall_summary": "",
            }
        else:
            # Legacy reports can still be finalized; new sessions never use this path.
            batch_eval_result = gemini_service.batch_evaluate_interview(
                role_title=saved_role,
                job_description=saved_jd,
                evaluation_items=evaluation_items
            )

        q_eval_list = batch_eval_result.get("question_evaluations", [])
        total_quality_score = 0
        total_communication_score = 0
        all_strengths = list(batch_eval_result.get("overall_strengths", []))
        all_improvements = list(batch_eval_result.get("overall_improvements", []))

        for q_ev in q_eval_list:
            total_quality_score += int(q_ev.get("answer_quality_score", 70))
            total_communication_score += int(q_ev.get("communication_score", 70))
            all_strengths.extend(q_ev.get("strengths", []))
            all_improvements.extend(q_ev.get("improvements", []))

        # Step C: Compute aggregated scores
        count = len(q_eval_list) if len(q_eval_list) > 0 else len(responses)
        avg_answer_quality = round(total_quality_score / count) if count > 0 else 70
        avg_communication = round(total_communication_score / count) if count > 0 else 70

        # Vision engagement score (safely cast float/str to int)
        vision_metrics = payload.vision_metrics or {}
        raw_eye_contact = vision_metrics.get("eyeContact", 75)
        try:
            camera_engagement = int(float(raw_eye_contact))
        except (ValueError, TypeError):
            camera_engagement = 75

        speech_fluency = max(50, min(98, 95 - (nlp_filler_summary["total_fillers"] * 2)))

        # Overall weighted score: 40% Answer Quality, 25% Communication, 20% Vision, 15% speech fluency.
        overall_score = round(
            (avg_answer_quality * 0.40) +
            (avg_communication * 0.25) +
            (camera_engagement * 0.20) +
            (speech_fluency * 0.15)
        )

        # Step D: Generate top unique strengths, improvements, and holistic feedback
        top_strengths = list(dict.fromkeys(all_strengths))[:4]
        top_improvements = list(dict.fromkeys(all_improvements))[:4]
        gemini_summary = batch_eval_result.get("overall_summary", "").strip()
        if gemini_summary:
            summary_feedback = gemini_summary
        else:
            summary_feedback = (
                f"Overall score: {overall_score}/100. "
                f"Answer quality averaged {avg_answer_quality}% and camera engagement reached {camera_engagement}%. "
                f"Focus on reducing the {nlp_filler_summary['total_fillers']} filler words used across the session."
            )

        # Step E: Save into evaluation_reports and update interview status in PostgreSQL
        with conn.cursor() as cur:
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
                    interview_id,
                    avg_answer_quality,
                    avg_communication,
                    speech_fluency,
                    speech_fluency,
                    camera_engagement,
                    overall_score,
                    json.dumps(vision_metrics),
                    json.dumps(nlp_filler_summary),
                    top_strengths,
                    top_improvements,
                    summary_feedback
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
                (overall_score, payload.duration_seconds, interview_id)
            )
            conn.commit()

        return completion_response({
            "interview_id": interview_id,
            "overall_score": overall_score,
            "answer_quality_score": avg_answer_quality,
            "communication_score": avg_communication,
            "speech_fluency_score": speech_fluency,
            "camera_engagement_score": camera_engagement,
            "strengths": top_strengths, "improvements": top_improvements,
            "summary_feedback": summary_feedback, "nlp_metrics": nlp_filler_summary,
        })
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Could not complete this interview. Please retry.")
    finally:
        conn.close()


# -------------------------------------------------------------
# BLOCK 8: Endpoint - Get Evaluation Report (For Report.jsx)
# -------------------------------------------------------------
@app.get("/api/interviews/{interview_id}/report")
def get_interview_report(interview_id: str):
    try:
        uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid interview_id UUID format.")

    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM evaluation_reports WHERE interview_id = %s;
                """,
                (interview_id,)
            )
            report = cur.fetchone()

        if not report:
            raise HTTPException(status_code=404, detail="Report not found.")
        return report
    finally:
        conn.close()


# -------------------------------------------------------------
# BLOCK 9: Endpoint - Get User Past Interviews (For Dashboard.jsx)
# -------------------------------------------------------------
@app.get("/api/interviews/user/{firebase_uid}")
def get_user_interviews(firebase_uid: str):
    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM users WHERE firebase_uid = %s;",
                (firebase_uid,)
            )
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
            rows = cur.fetchall()
        return rows
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
