"""Reviewer-only evidence chains from stored questions, results and observations."""
from datetime import datetime

import integrity


COUNT_KEYS = ("challenges", "passed", "partial", "failed")


def counts(verification=None):
    return {key: (verification or {}).get(key, 0) for key in COUNT_KEYS}


def _time(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _elapsed(value, started):
    try:
        value = datetime.fromisoformat(value) if isinstance(value, str) else value
        started = datetime.fromisoformat(started) if isinstance(started, str) else started
        return round(max(0, (value - started).total_seconds()), 2)
    except (TypeError, ValueError, AttributeError):
        return None


def build(cur, interview):
    """Include issued unanswered challenges; no integrity penalties are altered."""
    iid = str(interview["id"])
    cur.execute("""SELECT q.question_index, q.question_text, q.verification_meta,
                          r.verification_result, r.recording_part, r.answer_end_seconds, r.evaluated_at
                   FROM interview_questions q LEFT JOIN interview_responses r ON r.question_id = q.id
                   WHERE q.interview_id = %s AND q.kind = 'verify' ORDER BY q.question_index;""", (iid,))
    questions = cur.fetchall()
    cur.execute("""SELECT id, client_event_id, event_type, question_index, recording_part, at_seconds,
                          duration_seconds, created_at FROM proctoring_events
                   WHERE interview_id = %s ORDER BY created_at, id;""", (iid,))
    events = []
    for row in cur.fetchall():
        events.append({**row, "id": str(row.get("client_event_id") or row.get("id")),
                       "created_at": _time(row.get("created_at")),
                       "label": integrity.LABELS.get(row["event_type"], row["event_type"]),
                       "major": row["event_type"] in integrity.MAJOR_EVENTS})
    timeline = [{**e, "type": "integrity_evidence", "time_basis": "recording" if e.get("at_seconds") is not None else "server",
                 "at_seconds": e.get("at_seconds") if e.get("at_seconds") is not None else _elapsed(e.get("created_at"), interview.get("created_at"))}
                for e in events]
    summary = {**counts(), "details": [], "timeline": timeline}
    for question in questions:
        meta = question.get("verification_meta") or {}
        if not meta:
            continue
        index = question["question_index"]
        result = question.get("verification_result")
        summary["challenges"] += 1
        if result and result.get("status") in ("passed", "partial", "failed"):
            summary[result["status"]] += 1
        identifiers = set(meta.get("evidence_ids") or [])
        evidence = [e for e in events if e["id"] in identifiers]
        # Derived reading/voice/typing evidence also remains reviewable even
        # when no separate event row was raised during this answer.
        recorded_codes = {e["event_type"] for e in evidence}
        for code in meta.get("evidence_codes") or []:
            if code not in recorded_codes:
                derived = {"id": f"derived-{index}-{code}", "event_type": code,
                           "label": code.replace("_", " ").capitalize() + " (answer assessment)",
                           "question_index": meta.get("parent_question_index"), "recording_part": None,
                           "at_seconds": _elapsed(meta.get("generated_at"), interview.get("created_at")),
                           "created_at": meta.get("generated_at"), "time_basis": "assessment", "major": False}
                evidence.append(derived)
                timeline.append({**derived, "type": "integrity_evidence"})
        summary["details"].append({
            "question_index": index, "question": question["question_text"],
            "parent_question_index": meta.get("parent_question_index"),
            "trigger_reason": meta.get("reason") or meta.get("internal_reason") or "Multiple independent assistance indicators",
            "verification_target": meta.get("verification_target"), "challenge_type": meta.get("challenge_type"),
            "policy_version": meta.get("policy_version"), "risk_score": meta.get("risk_score"),
            "risk_level": meta.get("risk_level"), "evidence": evidence,
            "result": result, "generated_at": meta.get("generated_at"),
        })
        timeline.append({"id": f"verification-{index}", "type": "verification_requested",
                         "label": "Knowledge verification requested", "question_index": index,
                         "parent_question_index": meta.get("parent_question_index"), "major": False,
                         "recording_part": None, "at_seconds": _elapsed(meta.get("generated_at"), interview.get("created_at")),
                         "created_at": meta.get("generated_at"), "time_basis": "server"})
        if result:
            evaluated_at = _time(result.get("evaluated_at") or question.get("evaluated_at"))
            timeline.append({"id": f"verification-result-{index}", "type": "verification_result",
                             "label": f"Verification {result['status']}", "status": result["status"],
                             "score": result["score"], "question_index": index, "major": False,
                             "recording_part": None, "at_seconds": _elapsed(evaluated_at, interview.get("created_at")),
                             "created_at": evaluated_at, "time_basis": "server"})
    # Never pretend recording offsets from different reload parts share a
    # time origin. Receipt/generation timestamps give a stable server order;
    # recording offsets retain the observation's exact playback position.
    timeline.sort(key=lambda e: (e.get("created_at") or "", e["id"]))
    return summary
