import os
import shutil
import uuid
import json
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Ensure .env is loaded from backend directory
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
load_dotenv()

import database
import gemini_service
import nlp_evaluator

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
    user_id: Optional[str] = None
    role_title: str = "Software Engineer"
    job_description: Optional[str] = None

class EvaluateInterviewRequest(BaseModel):
    vision_metrics: Optional[dict] = None  # Received from Harsha's BehaviorMonitor.jsx


# -------------------------------------------------------------
# BLOCK 5: Endpoint - Start Interview & Generate Questions with Gemini
# -------------------------------------------------------------
# 1. Inserts a new row in 'interviews' table with role title and optional Job Description.
# 2. Calls Gemini to generate 5 role-specific questions and rubric points tailored to JD.
# 3. Vectorizes each rubric point using Gemini text-embedding-004.
# 4. Saves the rubric points and embeddings into 'question_rubrics' in PostgreSQL.
# 5. Returns the interview_id, questions list, and job_description to the frontend.
@app.post("/api/interviews/start")
def start_interview(payload: StartInterviewRequest):
    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            # Step A: Validate and handle user_id safely for foreign key constraint
            valid_user_id = None
            if payload.user_id and payload.user_id.strip():
                try:
                    user_uuid = str(uuid.UUID(payload.user_id.strip()))
                    cur.execute("SELECT id FROM users WHERE id = %s;", (user_uuid,))
                    if not cur.fetchone():
                        cur.execute(
                            """
                            INSERT INTO users (id, email, full_name)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (id) DO NOTHING;
                            """,
                            (user_uuid, f"user_{user_uuid[:8]}@example.com", "Interview Candidate")
                        )
                    valid_user_id = user_uuid
                except (ValueError, AttributeError):
                    # Not a valid UUID (e.g. Firebase string ID); store as NULL to avoid constraint violation
                    valid_user_id = None

            # Create interview session with target role and optional job description
            cur.execute(
                """
                INSERT INTO interviews (user_id, role_title, job_description, status)
                VALUES (%s, %s, %s, 'in_progress')
                RETURNING id;
                """,
                (valid_user_id, payload.role_title, payload.job_description)
            )
            interview_id = str(cur.fetchone()["id"])

            # Step B: Call Gemini to generate questions + rubric points tailored to role & JD
            questions_data = gemini_service.generate_interview_questions(
                payload.role_title, payload.job_description
            )

            # Step C: Generate vector embeddings for each rubric point and save in PostgreSQL
            for item in questions_data:
                q_index = item["index"]
                q_text = item["question"]
                for rubric in item.get("rubric_points", []):
                    # Embed rubric chunk with Gemini text-embedding-004 (768 numbers)
                    try:
                        embedding_vector = gemini_service.get_embedding(rubric)
                    except Exception as emb_err:
                        print(f"[EMBEDDING WARNING] Failed for rubric '{rubric}': {emb_err}")
                        embedding_vector = []

                    if embedding_vector and len(embedding_vector) > 0:
                        cur.execute(
                            """
                            INSERT INTO question_rubrics (
                                interview_id, question_index, question_text, ideal_concept_chunk, embedding
                            ) VALUES (%s, %s, %s, %s, %s);
                            """,
                            (interview_id, q_index, q_text, rubric, embedding_vector)
                        )

            conn.commit()
            return {
                "interview_id": interview_id,
                "role_title": payload.role_title,
                "job_description": payload.job_description,
                "questions": questions_data
            }
    except Exception as error:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(error))
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
async def submit_answer(
    interview_id: str,
    question_index: int = Form(...),
    question_text: str = Form(...),
    candidate_answer: str = Form(""),
    video: Optional[UploadFile] = File(None)
):
    try:
        uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid interview_id UUID format.")

    conn = database.get_db_connection()
    try:
        # Step A: Save video file to disk if uploaded
        video_url = None
        if video and video.filename:
            interview_folder = os.path.join(UPLOAD_DIR, interview_id)
            os.makedirs(interview_folder, exist_ok=True)
            video_filename = f"q_{question_index}.webm"
            saved_file_path = os.path.join(interview_folder, video_filename)

            with open(saved_file_path, "wb") as buffer:
                shutil.copyfileobj(video.file, buffer)

            video_url = f"/uploads/{interview_id}/{video_filename}"

        # Step B: Generate vector embedding of candidate's answer
        answer_vector = []
        similarity_score = 0.0
        if candidate_answer.strip():
            try:
                answer_vector = gemini_service.get_embedding(candidate_answer)
                if answer_vector:
                    # Query PostgreSQL for the top rubric matches & cosine similarity
                    _, similarity_score = nlp_evaluator.retrieve_top_rubric_matches(
                        conn, interview_id, question_index, answer_vector
                    )
            except Exception as emb_err:
                print(f"[SIMILARITY WARNING] Failed computing similarity: {emb_err}")
                similarity_score = 0.5

        # Step C: Insert answer row into interview_responses table
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO interview_responses (
                    interview_id, question_index, question_text, candidate_answer,
                    answer_embedding, semantic_similarity_score, video_url
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (
                    interview_id,
                    question_index,
                    question_text,
                    candidate_answer,
                    answer_vector if answer_vector else None,
                    similarity_score,
                    video_url
                )
            )
            response_id = str(cur.fetchone()["id"])
            conn.commit()

        return {
            "status": "success",
            "response_id": response_id,
            "semantic_similarity_score": round(similarity_score, 3),
            "video_url": video_url
        }
    except Exception as error:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        conn.close()


# -------------------------------------------------------------
# BLOCK 7: Endpoint - Complete Interview & Run RAG Evaluation
# -------------------------------------------------------------
# Called when the candidate finishes the interview.
# 1. Fetches all candidate responses from 'interview_responses'.
# 2. For each response, retrieves rubric points and runs RAG Gemini evaluation.
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
            cur.execute(
                """
                SELECT job_description, role_title FROM interviews WHERE id = %s;
                """,
                (interview_id,)
            )
            intv_row = cur.fetchone()
            saved_jd = intv_row["job_description"] if intv_row else None
            saved_role = intv_row["role_title"] if intv_row else "Software Engineer"

            cur.execute(
                """
                SELECT question_index, question_text, candidate_answer, semantic_similarity_score
                FROM interview_responses
                WHERE interview_id = %s
                ORDER BY question_index ASC;
                """,
                (interview_id,)
            )
            responses = cur.fetchall()

        if not responses:
            raise HTTPException(status_code=400, detail="No answers found for this interview.")

        # Step B: Prepare all responses and run High-Speed Batch Evaluation in ONE Gemini request
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

            # 2. Retrieve the rubric points from PostgreSQL
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

        # Step B.2: High-Speed Batch Evaluation (1 single API call instead of 5 in sequence)
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

        voice_confidence = max(50, min(98, 95 - (nlp_filler_summary["total_fillers"] * 2)))

        # Overall weighted score: 40% Answer Quality, 25% Communication, 20% Vision, 15% Voice
        overall_score = round(
            (avg_answer_quality * 0.40) +
            (avg_communication * 0.25) +
            (camera_engagement * 0.20) +
            (voice_confidence * 0.15)
        )

        # Step D: Generate top unique strengths, improvements, and holistic feedback
        top_strengths = list(dict.fromkeys(all_strengths))[:4]
        top_improvements = list(dict.fromkeys(all_improvements))[:4]
        gemini_summary = batch_eval_result.get("overall_summary", "").strip()
        if gemini_summary:
            summary_feedback = gemini_summary
        else:
            summary_feedback = (
                f"Overall performance was solid with a score of {overall_score}/100. "
                f"Answer quality averaged {avg_answer_quality}% and camera engagement reached {camera_engagement}%. "
                f"Focus on reducing the {nlp_filler_summary['total_fillers']} filler words used across the session."
            )

        # Step E: Save into evaluation_reports and update interview status in PostgreSQL
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO evaluation_reports (
                    interview_id, answer_quality_score, communication_score,
                    voice_confidence_score, camera_engagement_score, overall_score,
                    vision_metrics, nlp_metrics, strengths, improvements, summary_feedback
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (
                    interview_id,
                    avg_answer_quality,
                    avg_communication,
                    voice_confidence,
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
                SET status = 'evaluated', overall_score = %s, completed_at = NOW()
                WHERE id = %s;
                """,
                (overall_score, interview_id)
            )
            conn.commit()

        return {
            "interview_id": interview_id,
            "overall_score": overall_score,
            "scores": [
                {"label": "Answer Quality", "value": avg_answer_quality},
                {"label": "Communication", "value": avg_communication},
                {"label": "Voice Confidence", "value": voice_confidence},
                {"label": "Camera Engagement", "value": camera_engagement}
            ],
            "strengths": top_strengths,
            "improvements": top_improvements,
            "feedback": summary_feedback,
            "nlp_metrics": nlp_filler_summary
        }
    except Exception as error:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(error))
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
@app.get("/api/interviews/user/{user_id}")
def get_user_interviews(user_id: str):
    # Validate UUID format to avoid Postgres syntax error
    try:
        user_uuid = str(uuid.UUID(user_id))
    except (ValueError, AttributeError):
        return []

    conn = database.get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, role_title, status, duration_seconds, overall_score, created_at, completed_at
                FROM interviews
                WHERE user_id = %s
                ORDER BY created_at DESC;
                """,
                (user_uuid,)
            )
            rows = cur.fetchall()
        return rows
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
