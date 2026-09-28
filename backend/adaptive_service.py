"""Persistence and orchestration for adaptive turns.

All mutating callers lock the parent interview until commit. This serializes
submit, advance and completion across processes, including external AI calls.
"""
import json
import logging
import uuid

from fastapi import HTTPException
import gemini_service
import nlp_evaluator
import arena
from adaptive import adaptation_for

logger = logging.getLogger(__name__)
EVALUATION_FIELDS = (
    "answer_quality_score", "communication_score", "strengths", "improvements",
    "feedback", "missing_concepts", "evaluation_source",
)


def public_evaluation(response):
    return {key: response[key] for key in EVALUATION_FIELDS}


def public_question(question):
    return {
        "index": question["question_index"], "question": question["question_text"],
        "difficulty": question["difficulty"], "is_follow_up": question["is_follow_up"],
        "topic": question["topic"],
        **({"boss_round": True} if question.get("boss_round") else {}),
    }


def lock_interview(cur, interview_id):
    try:
        uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(400, "Invalid interview_id UUID format.")
    cur.execute("SELECT * FROM interviews WHERE id = %s FOR UPDATE;", (interview_id,))
    interview = cur.fetchone()
    if not interview:
        raise HTTPException(404, "Interview not found.")
    return interview


def require_active(interview):
    if interview["status"] != "in_progress":
        raise HTTPException(409, "Interview is no longer active.")


def store_question(cur, interview_id, turn, content):
    cur.execute(
        """INSERT INTO interview_questions
           (interview_id, question_index, question_text, difficulty, is_follow_up,
            topic, adaptive_reason, rubric_points, boss_round)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *;""",
        (interview_id, turn, content["question"], content["difficulty"],
         content["is_follow_up"], content["topic"], content["adaptive_reason"],
         json.dumps(content["rubric_points"]), content.get("boss_round", False)),
    )
    question = cur.fetchone()
    for rubric in content["rubric_points"]:
        try:
            embedding = gemini_service.get_embedding(rubric)
        except Exception:
            embedding = []
        # Keep the textual rubric even when the embedding provider fails.
        cur.execute(
            """INSERT INTO question_rubrics
               (interview_id, question_index, question_text, ideal_concept_chunk, embedding)
               VALUES (%s,%s,%s,%s,%s);""",
            (interview_id, turn, content["question"], rubric, embedding),
        )
    return question


def question_for_submission(cur, interview, question_index):
    require_active(interview)
    if question_index != interview["current_turn"]:
        raise HTTPException(409, "Submit the current question before advancing.")
    cur.execute(
        "SELECT * FROM interview_questions WHERE interview_id = %s AND question_index = %s;",
        (str(interview["id"]), question_index),
    )
    question = cur.fetchone()
    if not question:
        raise HTTPException(409, "This legacy session has no adaptive question. Start a new interview.")
    return question


def existing_submission(cur, question):
    cur.execute("SELECT * FROM interview_responses WHERE question_id = %s;", (str(question["id"]),))
    return cur.fetchone()


def submission_result(response):
    return {
        "status": "success", "response_id": str(response["id"]),
        "semantic_similarity_score": round(response["semantic_similarity_score"] or 0, 3),
        "video_url": response["video_url"],
        "evaluation": public_evaluation(response),
    }


def evaluate_and_store(conn, cur, interview, question, answer, video_url):
    try:
        vector = gemini_service.get_embedding(answer) if answer.strip() else []
    except Exception:
        vector = []
    rubric = question["rubric_points"]
    similarity = 0.0
    if vector:
        retrieved, similarity = nlp_evaluator.retrieve_top_rubric_matches(
            conn, str(interview["id"]), question["question_index"], vector,
        )
        rubric = retrieved or rubric
    fillers = nlp_evaluator.count_filler_words(answer)
    evaluation = gemini_service.evaluate_answer_with_rag(
        question["question_text"], answer, rubric, similarity, fillers["total_count"],
        interview["job_description"],
    )
    cur.execute(
        """INSERT INTO interview_responses (
           interview_id, question_id, question_index, question_text, candidate_answer,
           answer_embedding, semantic_similarity_score, video_url, difficulty,
           is_follow_up, topic, adaptive_reason, answer_quality_score, communication_score,
           feedback, strengths, improvements, missing_concepts, filler_metrics,
           evaluation_source, evaluated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
           RETURNING *;""",
        (str(interview["id"]), str(question["id"]), question["question_index"],
         question["question_text"], answer, vector or None, similarity, video_url,
         question["difficulty"], question["is_follow_up"], question["topic"],
         question["adaptive_reason"], evaluation["answer_quality_score"],
         evaluation["communication_score"], evaluation["feedback"],
         json.dumps(evaluation["strengths"]), json.dumps(evaluation["improvements"]),
         json.dumps(evaluation["missing_concepts"]), json.dumps(fillers),
         evaluation["evaluation_source"]),
    )
    return cur.fetchone()


def advance(cur, interview, response_id=None):
    if interview.get("interview_mode") != "game":
        require_active(interview)
    if response_id:
        cur.execute(
            "SELECT * FROM interview_responses WHERE interview_id = %s AND id = %s;",
            (str(interview["id"]), str(response_id)),
        )
    else:
        cur.execute(
            """SELECT * FROM interview_responses WHERE interview_id = %s
               ORDER BY question_index DESC, created_at DESC LIMIT 1;""",
            (str(interview["id"]),),
        )
    response = cur.fetchone()
    if not response:
        raise HTTPException(409, "Submit an answer first.")
    if response["next_result"] is not None:
        return response["next_result"]
    require_active(interview)
    if response["question_index"] != interview["current_turn"] or not response["question_id"]:
        raise HTTPException(409, "The submitted answer does not match the active adaptive turn.")
    if response["evaluated_at"] is None:
        raise HTTPException(409, "Answer evaluation is not yet available.")

    adaptation = adaptation_for(response)
    final_turn = interview["current_turn"] >= interview["max_turns"]
    turn = interview["current_turn"]
    next_question = None
    boss_round = arena.is_boss(interview.get('interview_mode'), turn + 1, interview['max_turns'])
    if boss_round and not final_turn:
        adaptation.update(next_difficulty='expert' if adaptation['next_difficulty'] == 'expert' else 'hard',
                          is_follow_up=False, reason='Final Arena scenario tests multi-concept reasoning.')
    if final_turn:
        adaptation.update(next_difficulty=response["difficulty"], is_follow_up=False,
                          reason="Maximum answer turns reached; finalize the report.")
    else:
        cur.execute(
            """SELECT q.topic, q.question_text AS question, q.difficulty,
                      r.answer_quality_score AS score
               FROM interview_questions q LEFT JOIN interview_responses r ON r.question_id = q.id
               WHERE q.interview_id = %s ORDER BY q.question_index;""",
            (str(interview["id"]),),
        )
        # At most 20 short entries; no identity/profile fields or answer history.
        history = cur.fetchall()
        content = gemini_service.generate_adaptive_question(
            role_title=interview["role_title"],
            job_description=(interview["job_description"] or "")[:4000],
            current_difficulty=adaptation["next_difficulty"],
            previous_question=response["question_text"],
            previous_topic=response["topic"],
            candidate_answer=(response["candidate_answer"] or "")[:8000],
            **public_evaluation(response),
            recent_history=history, is_follow_up=adaptation["is_follow_up"],
            recovery=response["answer_quality_score"] < 50,
            turn_number=turn + 1, max_turns=interview["max_turns"], boss_round=boss_round,
        )
        turn += 1
        next_question = public_question(store_question(cur, str(interview["id"]), turn, content))
        cur.execute(
            "UPDATE interviews SET current_turn = %s, current_difficulty = %s WHERE id = %s;",
            (turn, adaptation["next_difficulty"], str(interview["id"])),
        )
    result = {
        "evaluation": public_evaluation(response), "adaptation": adaptation,
        "next_question": next_question, "current_turn": turn,
        "max_turns": interview["max_turns"], "is_complete": final_turn,
    }
    if interview.get('interview_mode') == 'game':
        result['game'] = arena.award(cur, interview, response)
        if final_turn:
            cur.execute("""UPDATE interviews SET status='completed', completed_at=NOW(),
                duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (NOW()-created_at))::integer),
                overall_score=(SELECT ROUND(AVG(answer_quality_score)) FROM interview_responses WHERE interview_id=%s)
                WHERE id=%s;""", (str(interview['id']), str(interview['id'])))
    cur.execute("UPDATE interview_responses SET next_result = %s WHERE id = %s;",
                (json.dumps(result), str(response["id"])))
    logger.info(
        "Interview %s turn %s previous=%s score=%s follow_up=%s next=%s complete=%s",
        interview["id"], turn, response["difficulty"], response["answer_quality_score"],
        adaptation["is_follow_up"], adaptation["next_difficulty"], final_turn,
    )
    return result
