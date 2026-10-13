"""Integrity assessment of every answer, shared by interviews and the Arena.

Combines what was stored during the session — identity checks (identity.py),
live proctoring events and browser signals — with reading detection, then
applies the per-answer penalties from malpractice.py.
"""
import json

import malpractice


def load_evidence(cur, interview_id: str) -> dict:
    """Load recorded evidence once, shared by immediate and final assessment."""
    cur.execute("SELECT question_index, words FROM answer_transcripts WHERE interview_id = %s;", (interview_id,))
    words = {row["question_index"]: row["words"] for row in cur.fetchall()}
    cur.execute(
        """SELECT event_type, question_index, id, client_event_id, recording_part,
                  at_seconds, duration_seconds, created_at, details
           FROM proctoring_events WHERE interview_id = %s ORDER BY created_at, id;""", (interview_id,))
    events = cur.fetchall()
    cur.execute(
        """SELECT kind, question_index, verdict, similarity, details FROM identity_checks
           WHERE interview_id = %s ORDER BY created_at;""", (interview_id,))
    checks = cur.fetchall()
    cur.execute("SELECT 1 FROM identity_profiles WHERE interview_id = %s;", (interview_id,))
    return {"words": words, "events": events, "checks": checks, "enrolled": cur.fetchone() is not None}


def events_for_response(response, evidence, strict_boundary=False):
    """Attribute observations to an answer, never to its grading/processing time.

    Recording offsets allow delayed delivery of observations made before the
    answer closed. Untimed observations must have arrived before the server
    accepted the submission. Old reports retain their original attribution.
    """
    rows = [e for e in evidence.get("events", []) if e.get("question_index") == response["question_index"]]
    if not strict_boundary:
        return rows
    part, start, end = (response.get(k) for k in ("recording_part", "answer_start_seconds", "answer_end_seconds"))
    if response.get("observation_start_seconds") is not None:
        start = response["observation_start_seconds"]
    cutoff = response.get("submitted_at")
    eligible = []
    for event in rows:
        if part is not None and start is not None and end is not None and event.get("at_seconds") is not None:
            if event.get("recording_part") == part and start <= event["at_seconds"] <= end:
                eligible.append(event)
        elif cutoff is not None and event.get("created_at") is not None:
            if event["created_at"] <= cutoff:
                eligible.append(event)
    return eligible


def assess_response(response, evidence):
    """Pure interpretation used for both the Challenge Engine and penalties."""
    index = response["question_index"]
    strict = response.get("submitted_at") is not None and evidence.get("interview_mode") != "game"
    events = events_for_response(response, evidence, strict_boundary=strict)
    kinds = [event["event_type"] for event in events]
    voice = None
    for check in evidence.get("checks", []):
        if check["kind"] == "voice" and check["question_index"] == index:
            voice = {"verdict": check["verdict"], "similarity": check.get("similarity"), **(check.get("details") or {})}
    reading = malpractice.reading_assessment(
        evidence.get("words", {}).get(index), response.get("candidate_answer") or "", response.get("speech_metrics"),
        response.get("answer_signals"), response.get("content_signals"))
    result = malpractice.assess_answer(voice_check=voice, face_mismatch="face_mismatch" in kinds,
                                      events=kinds, signals=response.get("answer_signals"), reading=reading)
    result["voice"] = {k: voice.get(k) for k in ("verdict", "similarity")} if voice else None
    return result


def assess(cur, interview_id: str, responses: list, interview_mode="standard") -> tuple[dict, dict]:
    evidence = load_evidence(cur, interview_id)
    evidence["interview_mode"] = interview_mode
    assessments = {r["question_index"]: assess_response(r, evidence) for r in responses}

    def tally(kind):
        counts = {}
        for check in evidence["checks"]:
            if check["kind"] == kind:
                counts[check["verdict"]] = counts.get(check["verdict"], 0) + 1
        return counts

    return assessments, {
        "enrolled": evidence["enrolled"], "voice_checks": tally("voice"), "face_checks": tally("face"),
        "face_mismatch_events": sum(e["event_type"] == "face_mismatch" for e in evidence["events"]),
    }


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
                **(response.get("integrity") or {}),
                "flags": result["flags"], "action": result["action"],
                "reading": {key: result["reading"][key] for key in ("level", "score", "evidence")},
                "voice": result["voice"],
                "original_score": response.get("answer_quality_score"),
                "adjusted_score": adjusted.get("answer_quality_score"),
            }), str(response["id"])),
        )
    return adjusted_scores
