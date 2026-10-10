"""Integrity assessment of every answer, shared by interviews and the Arena.

Combines what was stored during the session — identity checks (identity.py),
live proctoring events and browser signals — with reading detection, then
applies the per-answer penalties from malpractice.py.
"""
import json

import malpractice


def assess(cur, interview_id: str, responses: list) -> tuple[dict, dict]:
    """Per-answer integrity assessments (keyed by question index) and an
    identity summary, from stored checks, events and browser signals."""
    cur.execute("SELECT question_index, words FROM answer_transcripts WHERE interview_id = %s;", (interview_id,))
    words = {row["question_index"]: row["words"] for row in cur.fetchall()}
    cur.execute("SELECT event_type, question_index FROM proctoring_events WHERE interview_id = %s;",
                (interview_id,))
    events: dict = {}
    for row in cur.fetchall():
        events.setdefault(row["question_index"], []).append(row["event_type"])
    cur.execute(
        """SELECT kind, question_index, verdict, similarity, details FROM identity_checks
           WHERE interview_id = %s ORDER BY created_at;""",
        (interview_id,),
    )
    checks = cur.fetchall()
    voice = {}
    for check in checks:
        if check["kind"] == "voice":
            voice[check["question_index"]] = check["details"] or {"verdict": check["verdict"]}
    cur.execute("SELECT 1 FROM identity_profiles WHERE interview_id = %s;", (interview_id,))
    enrolled = cur.fetchone() is not None

    assessments = {}
    for response in responses:
        index = response["question_index"]
        answer_events = events.get(index, [])
        reading = malpractice.reading_assessment(
            words.get(index), response.get("candidate_answer") or "", response.get("speech_metrics"),
            response.get("answer_signals"), response.get("content_signals"),
        )
        assessment = malpractice.assess_answer(
            voice_check=voice.get(index), face_mismatch="face_mismatch" in answer_events,
            events=answer_events, signals=response.get("answer_signals"), reading=reading,
        )
        assessment["voice"] = {k: voice[index].get(k) for k in ("verdict", "similarity")} if index in voice else None
        assessments[index] = assessment

    def tally(kind):
        counts: dict = {}
        for check in checks:
            if check["kind"] == kind:
                counts[check["verdict"]] = counts.get(check["verdict"], 0) + 1
        return counts

    identity_summary = {
        "enrolled": enrolled,
        "voice_checks": tally("voice"),
        "face_checks": tally("face"),
        "face_mismatch_events": sum(1 for kinds in events.values() for k in kinds if k == "face_mismatch"),
    }
    return assessments, identity_summary


def store(cur, responses: list, assessments: dict) -> dict:
    """Save each answer's flags and penalty; return the adjusted scores by question index."""
    adjusted_scores = {}
    for response in responses:
        result = assessments[response["question_index"]]
        adjusted = malpractice.apply_penalty(response, result)
        adjusted_scores[response["question_index"]] = adjusted.get("answer_quality_score")
        cur.execute(
            "UPDATE interview_responses SET integrity = %s WHERE id = %s;",
            (json.dumps({
                "flags": result["flags"], "action": result["action"],
                "reading": {key: result["reading"][key] for key in ("level", "score", "evidence")},
                "voice": result["voice"],
                "original_score": response.get("answer_quality_score"),
                "adjusted_score": adjusted.get("answer_quality_score"),
            }), str(response["id"])),
        )
    return adjusted_scores
