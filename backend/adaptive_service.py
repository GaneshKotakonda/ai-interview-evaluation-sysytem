"""Persistence and orchestration for adaptive interview turns.

Concurrency model: every mutating endpoint first locks the parent
``interviews`` row (``SELECT ... FOR UPDATE``) and holds it until commit.
That serialises submit, advance and completion for one interview across
processes, including the time spent waiting on Gemini.

Idempotency: a submitted answer is stored once per question, and the result
of advancing past it is cached in ``interview_responses.next_result``, so a
client retry after a network failure gets the original result back.
"""
import json
import logging
import uuid

from fastapi import HTTPException

import arena
import gemini_service
import nlp_evaluator
from adaptive import adaptation_for

logger = logging.getLogger(__name__)

# Evaluation fields that are safe to show the candidate (no rubric text).
EVALUATION_FIELDS = (
    "answer_quality_score", "communication_score", "strengths", "improvements",
    "feedback", "missing_concepts", "evaluation_source",
)
# Added later (scoring v2); older rows may not have them.
OPTIONAL_EVALUATION_FIELDS = ("criteria_scores",)


# -------------------------------------------------------------
# BLOCK 1: Public (candidate-visible) projections
# -------------------------------------------------------------
def public_evaluation(response):
    """Return only the candidate-visible evaluation fields of a response row."""
    result = {key: response[key] for key in EVALUATION_FIELDS}
    for key in OPTIONAL_EVALUATION_FIELDS:
        result[key] = response.get(key)
    return result


def public_question(question):
    """Return a question row without its private rubric."""
    return {
        "index": question["question_index"], "question": question["question_text"],
        "difficulty": question["difficulty"], "is_follow_up": question["is_follow_up"],
        "topic": question["topic"],
        **({"boss_round": True} if question.get("boss_round") else {}),
    }


# -------------------------------------------------------------
# BLOCK 2: Loading and guarding the interview row
# -------------------------------------------------------------
def fetch_interview(cur, interview_id, lock=True):
    """Load an interview by UUID; 400 on a malformed id, 404 when missing.

    ``lock=True`` adds ``FOR UPDATE`` (required before any write);
    read-only endpoints pass ``lock=False`` to avoid blocking active turns.
    """
    try:
        uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(400, "Invalid interview_id UUID format.")
    suffix = " FOR UPDATE" if lock else ""
    cur.execute(f"SELECT * FROM interviews WHERE id = %s{suffix};", (interview_id,))
    interview = cur.fetchone()
    if not interview:
        raise HTTPException(404, "Interview not found.")
    return interview


def lock_interview(cur, interview_id):
    """Load and row-lock an interview (see ``fetch_interview``)."""
    return fetch_interview(cur, interview_id, lock=True)


def require_active(interview):
    """409 unless the interview is still in progress."""
    if interview["status"] != "in_progress":
        raise HTTPException(409, "Interview is no longer active.")


# -------------------------------------------------------------
# BLOCK 3: Storing a generated question and its rubric vectors
# -------------------------------------------------------------
def store_question(cur, interview_id, turn, content):
    """Insert the question row, then one ``question_rubrics`` row per point.

    Each rubric point is embedded for later vector search. When embedding
    fails the text is still stored with an empty vector, so grading can use
    the full rubric instead of the retrieved subset.
    """
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
    # One batched embedding request for all rubric points (see get_embeddings).
    embeddings = gemini_service.get_embeddings(content["rubric_points"])
    for rubric, embedding in zip(content["rubric_points"], embeddings):
        cur.execute(
            """INSERT INTO question_rubrics
               (interview_id, question_index, question_text, ideal_concept_chunk, embedding)
               VALUES (%s,%s,%s,%s,%s);""",
            (interview_id, turn, content["question"], rubric, embedding),
        )
    return question


# -------------------------------------------------------------
# BLOCK 4: Answer submission helpers
# -------------------------------------------------------------
def question_for_submission(cur, interview, question_index):
    """Return the server-issued question for the active turn, or 409."""
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
    """Return the stored response for ``question``, if one was accepted."""
    cur.execute("SELECT * FROM interview_responses WHERE question_id = %s;", (str(question["id"]),))
    return cur.fetchone()


def submission_result(response):
    """API payload returned by /submit-answer (initial call and retries)."""
    return {
        "status": "success", "response_id": str(response["id"]),
        "semantic_similarity_score": round(response["semantic_similarity_score"] or 0, 3),
        "video_url": response["video_url"],
        "evaluation": public_evaluation(response),
    }


def transcript_for_turn(cur, interview_id, question_index):
    """Return the saved speech-to-text row for one turn, if any."""
    cur.execute(
        "SELECT * FROM answer_transcripts WHERE interview_id = %s AND question_index = %s;",
        (str(interview_id), question_index),
    )
    return cur.fetchone()


def evaluate_and_store(conn, cur, interview, question, answer, video_url, vision_metrics=None,
                       recording=None):
    """Embed, retrieve rubric matches, grade with Gemini and persist one answer.

    Pipeline: answer embedding → cosine search over this question's rubric
    vectors → filler count → Gemini grading (with fallback) → INSERT.
    When the answer was spoken, the transcript and its delivery metrics
    (computed at transcription time from the audio) are stored with it;
    ``answer`` is the text the candidate submitted, possibly edited.
    """
    # Step A: Embed the answer (empty or failed embeddings skip retrieval).
    try:
        vector = gemini_service.get_embedding(answer) if answer.strip() else []
    except Exception:
        vector = []

    # Step B: Retrieve the closest rubric points; default to the full rubric.
    rubric = question["rubric_points"]
    similarity = 0.0
    if vector:
        retrieved, similarity = nlp_evaluator.retrieve_top_rubric_matches(
            conn, str(interview["id"]), question["question_index"], vector,
        )
        rubric = retrieved or rubric

    # Step C: Communication signal and AI grading.
    fillers = nlp_evaluator.count_filler_words(answer)
    evaluation = gemini_service.evaluate_answer_with_rag(
        question["question_text"], answer, rubric, similarity, fillers["total_count"],
        interview["job_description"],
    )

    # Step D: Speech-to-text output for this turn, if the answer was spoken.
    spoken = transcript_for_turn(cur, interview["id"], question["question_index"]) or {}
    speech_metrics = spoken.get("speech_metrics")
    criteria = evaluation.get("criteria_scores")

    # Step E: Persist the answer with a copy of the question metadata.
    cur.execute(
        """INSERT INTO interview_responses (
           interview_id, question_id, question_index, question_text, candidate_answer,
           answer_embedding, semantic_similarity_score, video_url, difficulty,
           is_follow_up, topic, adaptive_reason, answer_quality_score, communication_score,
           feedback, strengths, improvements, missing_concepts, filler_metrics,
           evaluation_source, evaluated_at,
           criteria_scores, transcript, transcript_source, speech_metrics, vision_metrics, audio_path,
           recording_part, answer_start_seconds, answer_end_seconds)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),
                   %s,%s,%s,%s,%s,%s,%s,%s,%s)
           RETURNING *;""",
        (str(interview["id"]), str(question["id"]), question["question_index"],
         question["question_text"], answer, vector or None, similarity, video_url,
         question["difficulty"], question["is_follow_up"], question["topic"],
         question["adaptive_reason"], evaluation["answer_quality_score"],
         evaluation["communication_score"], evaluation["feedback"],
         json.dumps(evaluation["strengths"]), json.dumps(evaluation["improvements"]),
         json.dumps(evaluation["missing_concepts"]), json.dumps(fillers),
         evaluation["evaluation_source"],
         json.dumps(criteria) if criteria else None,
         spoken.get("transcript"), spoken.get("source"),
         json.dumps(speech_metrics) if speech_metrics else None,
         json.dumps(vision_metrics) if vision_metrics else None,
         spoken.get("audio_path"),
         (recording or {}).get("part"), (recording or {}).get("start"), (recording or {}).get("end")),
    )
    return cur.fetchone()


# -------------------------------------------------------------
# BLOCK 5: Advancing to the next turn
# -------------------------------------------------------------
def advance(cur, interview, response_id=None):
    """Apply the adaptive policy to the latest answer and issue the next turn.

    Returns the cached result when this response was already advanced, so
    retries are safe. On the final turn no question is generated and
    ``is_complete`` is True; Arena sessions are also closed here.
    """
    # Step A: Arena retries may arrive after the session completed; their
    # cached result is still returned, so the active check is deferred.
    if interview.get("interview_mode") != "game":
        require_active(interview)

    # Step B: Find the response being advanced (explicit token or latest).
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

    # Step C: Deterministic policy, then Arena/final-turn overrides.
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
        # Step D: Generate and store the next question with a short,
        # identity-free history so the model avoids repeated topics.
        cur.execute(
            """SELECT q.topic, q.question_text AS question, q.difficulty,
                      r.answer_quality_score AS score
               FROM interview_questions q LEFT JOIN interview_responses r ON r.question_id = q.id
               WHERE q.interview_id = %s ORDER BY q.question_index;""",
            (str(interview["id"]),),
        )
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

    # Step E: Arena awards XP every turn and closes the session itself.
    if interview.get('interview_mode') == 'game':
        result['game'] = arena.award(cur, interview, response)
        if final_turn:
            cur.execute("""UPDATE interviews SET status='completed', completed_at=NOW(),
                duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (NOW()-created_at))::integer),
                overall_score=(SELECT ROUND(AVG(answer_quality_score)) FROM interview_responses WHERE interview_id=%s)
                WHERE id=%s;""", (str(interview['id']), str(interview['id'])))

    # Step F: Cache the result for idempotent retries.
    cur.execute("UPDATE interview_responses SET next_result = %s WHERE id = %s;",
                (json.dumps(result), str(response["id"])))
    logger.info(
        "Interview %s turn %s previous=%s score=%s follow_up=%s next=%s complete=%s",
        interview["id"], turn, response["difficulty"], response["answer_quality_score"],
        adaptation["is_follow_up"], adaptation["next_difficulty"], final_turn,
    )
    return result


# -------------------------------------------------------------
# BLOCK 6: Per-turn summary for saved reports
# -------------------------------------------------------------
def report_turns(cur, interview_id):
    """Return the candidate-visible journey of a finished interview.

    Lets the Report page show every turn for any past interview, not only
    the one whose progress is still in this browser's localStorage.
    """
    cur.execute(
        """SELECT r.question_index, r.question_text, r.difficulty, r.is_follow_up, r.topic,
                  r.answer_quality_score, r.communication_score, r.feedback, r.evaluation_source,
                  r.next_result, r.criteria_scores, r.candidate_answer, r.transcript,
                  r.transcript_source, r.speech_metrics, r.vision_metrics, r.video_url, r.audio_path,
                  r.recording_part, r.answer_start_seconds, r.answer_end_seconds
           FROM interview_responses r
           WHERE r.interview_id = %s
           ORDER BY r.question_index;""",
        (interview_id,),
    )
    turns = []
    for row in cur.fetchall():
        cached = row.get("next_result") or {}
        turns.append({
            "index": row["question_index"],
            "question": row["question_text"],
            "difficulty": row["difficulty"],
            "is_follow_up": bool(row["is_follow_up"]),
            "topic": row["topic"],
            "answer": row.get("candidate_answer"),
            "transcript_source": row.get("transcript_source"),
            "evaluation": {
                "answer_quality_score": row["answer_quality_score"],
                "communication_score": row.get("communication_score"),
                "criteria_scores": row.get("criteria_scores"),
                "feedback": row["feedback"],
                "evaluation_source": row["evaluation_source"],
            },
            "speech_metrics": row.get("speech_metrics"),
            "vision_metrics": row.get("vision_metrics"),
            "has_video": bool(row.get("video_url")),
            "has_audio": bool(row.get("audio_path")),
            "recording": ({"part": row["recording_part"], "start": row.get("answer_start_seconds"),
                           "end": row.get("answer_end_seconds")} if row.get("recording_part") else None),
            "adaptation": cached.get("adaptation") if isinstance(cached, dict) else None,
        })
    return turns
