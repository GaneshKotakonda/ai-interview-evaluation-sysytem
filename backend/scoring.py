"""Pure scoring rules for the final Standard Interview report.

No database or network access, so every rule here is unit-testable.
"""
from typing import Iterable, Optional

import nlp_evaluator

# -------------------------------------------------------------
# BLOCK 1: Report weights
# -------------------------------------------------------------
# Overall score = weighted mean of four components. When no camera data
# was captured, the camera weight is dropped and the other three weights
# are re-normalised, instead of inventing a camera score.
WEIGHTS = {
    "answer_quality": 0.40,
    "communication": 0.25,
    "camera_engagement": 0.20,
    "speech_fluency": 0.15,
}

# Score used for a component when no per-answer value exists at all.
NEUTRAL_SCORE = 70


# -------------------------------------------------------------
# BLOCK 2: Component calculations
# -------------------------------------------------------------
def aggregate_fillers(answers: Iterable[str]) -> dict:
    """Sum filler-word counts over all answers.

    Returns ``{"total_fillers": int, "breakdown": {word: count}}``, the shape
    stored in ``evaluation_reports.nlp_metrics``.
    """
    summary = {"total_fillers": 0, "breakdown": {}}
    for answer in answers:
        result = nlp_evaluator.count_filler_words(answer or "")
        summary["total_fillers"] += result["total_count"]
        for word, count in result["breakdown"].items():
            summary["breakdown"][word] = summary["breakdown"].get(word, 0) + count
    return summary


def speech_fluency(total_fillers: int, answer_count: int) -> int:
    """95 minus 2 points per filler *per answer*, clamped to 50..98.

    Normalising by the number of answers keeps a 10-question interview from
    scoring lower than a 3-question one with the same speaking habits.
    """
    per_answer = total_fillers / max(1, answer_count)
    return round(max(50, min(98, 95 - per_answer * 2)))


def camera_engagement(vision_metrics: Optional[dict]) -> Optional[int]:
    """Return the eye-contact percentage (0..100), or None when unavailable.

    The browser sends ``{"eyeContact": <0-100>}`` from BehaviorMonitor.
    Missing or non-numeric values mean the camera model never produced
    data; out-of-range values are clamped.
    """
    raw = (vision_metrics or {}).get("eyeContact")
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value != value:  # NaN
        return None
    return int(max(0, min(100, round(value))))


def average_score(values: Iterable, default: int = NEUTRAL_SCORE) -> int:
    """Rounded mean of the non-null values, or ``default`` when there are none."""
    numbers = [int(v) for v in values if v is not None]
    return round(sum(numbers) / len(numbers)) if numbers else default


# -------------------------------------------------------------
# BLOCK 3: Overall score
# -------------------------------------------------------------
def overall_score(answer_quality: int, communication: int,
                  camera: Optional[int], fluency: int) -> int:
    """Weighted overall score in 0..100 (see WEIGHTS)."""
    parts = {
        "answer_quality": answer_quality,
        "communication": communication,
        "camera_engagement": camera,
        "speech_fluency": fluency,
    }
    used = {name: value for name, value in parts.items() if value is not None}
    total_weight = sum(WEIGHTS[name] for name in used)
    weighted = sum(WEIGHTS[name] * value for name, value in used.items())
    return round(weighted / total_weight)
