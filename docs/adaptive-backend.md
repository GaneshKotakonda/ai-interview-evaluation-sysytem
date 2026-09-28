# Adaptive backend: phase 2

New interviews use one production flow: start → submit/evaluate → next question
→ repeat → complete report. The fixed five-question backend generator is removed.
Pre-migration completed reports and Firebase UID history remain unchanged.
Batch evaluation remains only to finalize responses recorded before migration.

## Migration and configuration

Back up your database using your usual backup process. Stop the backend while
migrating, export its existing DATABASE_URL in the shell, and run from the project root:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn main:app --app-dir backend --reload --port 8000
```

Backend configuration goes in backend/.env:

- DATABASE_URL: your existing PostgreSQL connection string.
- GEMINI_API_KEY: your existing Gemini key.
- Optional GEMINI_QUESTION_MODEL and GEMINI_EVALUATION_MODEL; both default to
  the existing service's gemini-flash-lite-latest alias.

The API key must stay on the backend. VITE_API_BASE_URL is still optional,
defaulting to http://localhost:8000. Restart/rebuild Vite after changing it.

### Added storage

interviews:

- current_difficulty: medium by default; easy/medium/hard/expert only.
- interview_mode: standard by default; standard only in this phase.
- current_turn: 1 by default, positive.
- max_turns: 5 by default, from 1 through 20.

interview_questions is an additive table holding issued questions, turn number,
difficulty, topic, follow-up flag, adaptive reason and private JSONB rubric points.
A unique (interview_id, question_index) constraint prevents duplicate turns.
The text rubric also remains in question_rubrics when embeddings are unavailable.

interview_responses gains:

- question_id: unique nullable FK to issued questions; null for old responses.
- difficulty, answer_quality_score, communication_score, feedback.
- strengths, improvements, missing_concepts: JSONB arrays defaulting to [].
- is_follow_up: false by default; adaptive_reason and topic.
- filler_metrics: JSONB, evaluation_source, evaluated_at.
- next_result: JSONB cache for repeat advancement requests.

Scores are constrained to 0–100 and difficulty to the four allowed values.
Old response evaluation fields stay nullable; no existing rows or UUIDs are removed.
ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS make reapplication safe.

## API contracts

### Start

POST /api/interviews/start, application/json:

```json
{
  "firebase_uid": "YOUR_FIREBASE_UID",
  "email": "candidate@example.com",
  "full_name": "Candidate",
  "role_title": "Backend Engineer",
  "job_description": "Build HTTP APIs and PostgreSQL services",
  "max_turns": 5
}
```

Example response (UUID shortened here for readability):

```json
{
  "interview_id": "<uuid>",
  "role_title": "Backend Engineer",
  "job_description": "Build HTTP APIs and PostgreSQL services",
  "current_turn": 1,
  "max_turns": 5,
  "current_difficulty": "medium",
  "question": {
    "index": 1,
    "question": "How would you apply authentication in a backend service?",
    "difficulty": "medium",
    "is_follow_up": false,
    "topic": "Authentication"
  },
  "questions": [
    {
      "index": 1,
      "question": "How would you apply authentication in a backend service?",
      "difficulty": "medium",
      "is_follow_up": false,
      "topic": "Authentication"
    }
  ]
}
```

questions is a temporary shape-compatibility alias containing the same single
question. No additional questions are generated upfront. Private rubrics are never
included in this response. The old user_id request alias still means Firebase UID.

### Submit and immediately evaluate

POST /api/interviews/{id}/submit-answer retains multipart/form-data:

- question_index: current turn number.
- question_text: retained for API compatibility; evaluation uses server text.
- candidate_answer: answer/transcript.
- video: optional WebM upload, preserved under the existing uploads path.

```sh
curl -X POST "http://localhost:8000/api/interviews/INTERVIEW_UUID/submit-answer" \
  -F 'question_index=1' \
  -F 'question_text=The issued question' \
  -F 'candidate_answer=Your actual answer'
```

Example response:

```json
{
  "status": "success",
  "response_id": "<response-uuid>",
  "semantic_similarity_score": 0.81,
  "video_url": null,
  "evaluation": {
    "answer_quality_score": 90,
    "communication_score": 82,
    "strengths": ["Clearly distinguished authentication from authorization"],
    "improvements": ["Discuss token expiry"],
    "feedback": "Clear explanation with a relevant example.",
    "missing_concepts": ["Token expiry"],
    "evaluation_source": "gemini"
  }
}
```

The evaluation, metadata and filler metrics are committed with the answer.
An identical answer retry returns the accepted response without evaluating again
or replacing the recording. A changed answer to an accepted turn receives 409.

### Next question

POST /api/interviews/{id}/next-question accepts an empty body, {}, or:

```json
{"response_id": "<response-uuid>"}
```

Pass response_id from submission for reliable delayed retries. Without it, the
endpoint uses the latest submitted answer. All mutation paths lock the interview
row until commit; a unique question/turn and unique accepted response provide
additional database protection. Replays return the saved next_result.

Example response:

```json
{
  "evaluation": {
    "answer_quality_score": 90,
    "communication_score": 82,
    "strengths": ["Clear explanation"],
    "improvements": ["Discuss token expiry"],
    "feedback": "Clear explanation with a relevant example.",
    "missing_concepts": ["Token expiry"],
    "evaluation_source": "gemini"
  },
  "adaptation": {
    "previous_difficulty": "medium",
    "next_difficulty": "hard",
    "is_follow_up": false,
    "reason": "Strong technical coverage justified increasing difficulty."
  },
  "next_question": {
    "index": 2,
    "question": "How would you prevent lost updates during concurrent writes?",
    "difficulty": "hard",
    "is_follow_up": false,
    "topic": "Concurrent updates"
  },
  "current_turn": 2,
  "max_turns": 5,
  "is_complete": false
}
```

At the final turn next_question is null, current_turn stays at max_turns, and
is_complete is true. No new question is generated. Status remains in_progress
until POST /api/interviews/{id}/complete with:

```json
{"vision_metrics": {"eyeContact": 80}, "duration_seconds": 420}
```

Completion aggregates saved evaluations with the existing vision/voice weights,
saves the final report, duration and completed_at, and marks status completed.
It rejects premature adaptive completion with 409. Retries return the same report
contract without grading again.

Missing interview: 404. Missing answer, wrong turn, or completed interview: 409.
Invalid request fields: 422. Database/transaction failures: 500, safe to retry.
Question or evaluator model failures use the fallbacks below.

## Deterministic policy

| Technical answer score | Next action |
| --- | --- |
| 85–100 | Increase one level, capped at expert |
| 70–84 | Same level, new topic |
| 50–69 | Same level; follow-up only if a specific gap AND a strength were identified |
| 0–49 | Decrease one level, floored at easy; recovery/concept question |

A follow-up is allowed only for a Gemini evaluation, never an approximate offline
score. The immediately previous question must not itself be a follow-up.
Topic identity stays fixed across the follow-up; afterward move to a new topic.
Follow-ups count toward max_turns. Communication score informs generation and the
final report but does not control difficulty.

## Gemini and fallback behavior

Generation receives role/JD, backend-selected difficulty, previous question/answer,
the saved evaluation, follow-up intent, turn limits, and short topic/question/score
history (at most 20 turns). Firebase identity and profile fields are excluded.

Internal generated JSON contains question, difficulty, is_follow_up, topic,
adaptive_reason and private rubric_points. Types, lengths, repeated topics,
near-identical question wording and backend policy are validated. Invalid JSON,
wrong difficulty/follow-up metadata or service failures select a deterministic
fallback. Follow-up fallback refers to the prior topic and missing concept.

Fallback categories cover software, frontend, backend, database and programming.
Difficulty changes wording from basic purpose through production trade-offs to
scale/partial failure reasoning. Topics already used are skipped.

Immediate evaluation reuses embeddings, rubric retrieval and filler counting with
evaluate_answer_with_rag. Invalid scores/JSON or service failure return explicitly
approximate scores with evaluation_source=fallback, no invented strengths/gaps.
Empty answers score zero. Verbatim private rubric statements in evaluation output
are rejected; missing concepts must be short topic summaries.

Adaptive logging contains interview ID, turn, score, difficulties and follow-up
choice. It does not contain candidate answers, profile data or API keys.

## Validation

```sh
npm test -- --run
npm run build
python3 -m unittest discover -s backend -p 'test_*.py' -v
python3 -m py_compile backend/main.py backend/database.py backend/gemini_service.py backend/nlp_evaluator.py backend/adaptive.py backend/adaptive_questions.py backend/adaptive_service.py
git diff --check
```

Backend unit tests mock Gemini and the database boundary. They do not prove live
PostgreSQL migration execution or concurrency behavior; those require PostgreSQL.

## Manual scenario and frontend boundary

Use http://localhost:8000/docs or curl for this phase.

1. Start a five-turn interview and check only a medium first question exists.
2. Submit a strong answer. If its technical score is at least 85, call next-question
   with response_id and verify hard. Replay the same request: identical question,
   identical current_turn.
3. Answer the hard question partially. If it scores 50–69 and has both a strength
   and missing concept, advancement returns a hard follow-up about the same topic.
4. Answer that follow-up. The next question must move to a different topic even if
   this answer is also partial.
5. Continue submission/advancement through turn 5. Verify next_question=null and
   is_complete=true. Complete with duration and vision metrics, then check history.

Actual Gemini grading may not produce chosen test scores; the deterministic
threshold/follow-up tests exercise exact 90 and 60 score scenarios.

The existing Interview.jsx screen is intentionally unchanged in this phase. Its
fixed-array state still stops after the first returned question and receives 409
on premature completion. It requires the planned adaptive UI phase before the
browser interview workflow can be used with this backend. Do not roll this out
as a complete browser interview upgrade yet.

Pre-migration in-progress sessions can finalize already recorded answers, but
cannot request new adaptive turns; start a new interview to use adaptation.
