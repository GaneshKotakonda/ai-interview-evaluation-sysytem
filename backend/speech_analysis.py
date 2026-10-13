"""Speech delivery metrics from word-level timestamps.

Pure functions (no I/O), so every rule is unit-testable. Input is the
``words`` list produced by stt_service: ``[{word, start, end, probability}]``.

Metrics describe how the answer was spoken, not what was said:
pace (words per minute), filler words per minute and long pauses.
They are observable delivery signals, not judgements of confidence.
"""
from typing import Optional

import nlp_evaluator

# Conversational interview pace. Outside this band each word per minute
# costs half a point, up to the cap below.
IDEAL_WPM = (110, 160)
# A gap between two words at least this long counts as a long pause.
LONG_PAUSE_SECONDS = 1.5
# Fewer words than this cannot support a fair delivery score.
MIN_WORDS_FOR_SCORE = 8

PACE_PENALTY_PER_WPM = 0.5
PACE_PENALTY_CAP = 25
FILLER_ALLOWANCE_PER_MIN = 1.0   # an occasional "um" is natural
FILLER_PENALTY_PER_MIN = 6
FILLER_PENALTY_CAP = 30
PAUSE_PENALTY_EACH = 4
PAUSE_PENALTY_CAP = 20
SCORE_FLOOR = 20


def compute_metrics(words: list[dict], text: str) -> Optional[dict]:
    """Return delivery metrics for one answer, or None without word timings."""
    if not words:
        return None
    start, end = words[0]["start"], words[-1]["end"]
    span = max(end - start, 0.1)
    minutes = span / 60
    gaps = [max(0.0, b["start"] - a["end"]) for a, b in zip(words, words[1:])]
    long_pauses = [gap for gap in gaps if gap >= LONG_PAUSE_SECONDS]
    fillers = nlp_evaluator.count_filler_words(text)
    confidences = [w["probability"] for w in words if isinstance(w.get("probability"), (int, float))]

    metrics = {
        "word_count": len(words),
        "speaking_seconds": round(span, 1),
        "words_per_minute": round(len(words) / minutes),
        "long_pauses": len(long_pauses),
        "longest_pause_seconds": round(max(gaps, default=0.0), 1),
        "filler_count": fillers["total_count"],
        "fillers_per_minute": round(fillers["total_count"] / minutes, 1),
        "filler_breakdown": fillers["breakdown"],
        "transcript_confidence": round(sum(confidences) / len(confidences), 2) if confidences else None,
    }
    score, notes = delivery_score(metrics)
    metrics["delivery_score"] = score
    metrics["notes"] = notes
    return metrics


def delivery_score(metrics: Optional[dict]) -> tuple[Optional[int], list[str]]:
    """Score delivery 0..100 from pace, fillers and pauses, with reasons.

    Returns ``(None, [reason])`` when there is too little speech to judge.
    """
    if not metrics:
        return None, []
    if metrics["word_count"] < MIN_WORDS_FOR_SCORE:
        return None, ["Answer too short to measure delivery."]

    notes = []
    wpm = metrics["words_per_minute"]
    low, high = IDEAL_WPM
    pace_penalty = 0.0
    if wpm < low:
        pace_penalty = min(PACE_PENALTY_CAP, (low - wpm) * PACE_PENALTY_PER_WPM)
        notes.append(f"Pace was slow ({wpm} words/min); aim for {low}–{high}.")
    elif wpm > high:
        pace_penalty = min(PACE_PENALTY_CAP, (wpm - high) * PACE_PENALTY_PER_WPM)
        notes.append(f"Pace was fast ({wpm} words/min); slow down to {low}–{high}.")

    fpm = metrics["fillers_per_minute"]
    filler_penalty = min(FILLER_PENALTY_CAP, max(0.0, fpm - FILLER_ALLOWANCE_PER_MIN) * FILLER_PENALTY_PER_MIN)
    if fpm > 3:
        notes.append(f"Used {fpm} filler words per minute; pause silently instead.")

    pauses = metrics["long_pauses"]
    pause_penalty = min(PAUSE_PENALTY_CAP, pauses * PAUSE_PENALTY_EACH)
    if pauses >= 2:
        notes.append(f"{pauses} long pauses (over {LONG_PAUSE_SECONDS:g}s) broke the flow.")

    score = max(SCORE_FLOOR, round(100 - pace_penalty - filler_penalty - pause_penalty))
    if score >= 85 and not notes:
        notes.append("Steady pace with few fillers or long pauses.")
    return score, notes


def summarize(per_answer: list[Optional[dict]]) -> Optional[dict]:
    """Session summary over answers that have metrics (None when none do)."""
    rows = [m for m in per_answer if m]
    if not rows:
        return None
    scored = [m["delivery_score"] for m in rows if m.get("delivery_score") is not None]
    total_minutes = sum(m["speaking_seconds"] for m in rows) / 60
    total_words = sum(m["word_count"] for m in rows)
    total_fillers = sum(m["filler_count"] for m in rows)
    return {
        "answers_with_audio": len(rows),
        "delivery_score": round(sum(scored) / len(scored)) if scored else None,
        "words_per_minute": round(total_words / total_minutes) if total_minutes else None,
        "fillers_per_minute": round(total_fillers / total_minutes, 1) if total_minutes else None,
        "long_pauses": sum(m["long_pauses"] for m in rows),
        "speaking_seconds": round(sum(m["speaking_seconds"] for m in rows), 1),
    }
