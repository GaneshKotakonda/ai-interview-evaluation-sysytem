"""Pure scoring rules for the final Standard Interview report.

No database or network access, so every rule here is unit-testable.

Scoring v2 combines every module:
  answer quality   – Gemini + RAG, from four criteria (gemini_service)
  communication    – clarity and structure of the answer (Gemini)
  speech delivery  – pace, fillers and pauses from the audio (speech_analysis);
                     falls back to text filler counts when no audio exists
  camera engagement– eye contact, face presence and head alignment (MediaPipe)
"""
import math
from typing import Iterable, Optional

import nlp_evaluator

SCORING_VERSION = 2

# -------------------------------------------------------------
# BLOCK 1: Report weights
# -------------------------------------------------------------
# Overall score = weighted mean of four components. When a component has
# no data (e.g. no camera), its weight is dropped and the others are
# re-normalised, instead of inventing a value.
WEIGHTS = {
    "answer_quality": 0.40,
    "communication": 0.25,
    "camera_engagement": 0.20,
    "speech_fluency": 0.15,
}

# Score used for a component when no per-answer value exists at all.
NEUTRAL_SCORE = 70

# Camera engagement blends three observable signals.
CAMERA_SIGNAL_WEIGHTS = {"eyeContact": 0.5, "facePresence": 0.3, "cameraFacing": 0.2}
# Fewer analysed frames than this (about 3 s at 5 fps) is too little data.
MIN_VISION_FRAMES = 15
# A turn where the face was visible less than this share is flagged.
LOW_FACE_PRESENCE = 60


def _number(value) -> Optional[float]:
    """Finite float from a number or numeric string; None otherwise."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clamp_percent(value: float) -> int:
    return int(max(0, min(100, round(value))))


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
    """Text-only fallback: 95 minus 2 points per filler *per answer*, 50..98.

    Used when no answer was spoken. Normalising by the number of answers
    keeps a 10-question interview from scoring lower than a 3-question one.
    """
    per_answer = total_fillers / max(1, answer_count)
    return round(max(50, min(98, 95 - per_answer * 2)))


def camera_engagement(vision_metrics: Optional[dict]) -> Optional[int]:
    """Blend eye contact, face presence and head alignment into 0..100.

    Signals that are missing are left out and the remaining weights are
    re-normalised, so ``{"eyeContact": 80}`` alone scores 80. Returns None
    when no signal is usable or too few frames were analysed.
    """
    if not isinstance(vision_metrics, dict):
        return None
    frames = _number(vision_metrics.get("framesAnalyzed"))
    if frames is not None and frames < MIN_VISION_FRAMES:
        return None
    used = {}
    for key, weight in CAMERA_SIGNAL_WEIGHTS.items():
        value = _number(vision_metrics.get(key))
        if value is not None:
            used[key] = (weight, max(0.0, min(100.0, value)))
    if not used:
        return None
    total = sum(weight for weight, _ in used.values())
    return _clamp_percent(sum(weight * value for weight, value in used.values()) / total)


def sanitize_vision(raw) -> Optional[dict]:
    """Keep only known, well-typed vision fields from browser input."""
    if not isinstance(raw, dict):
        return None
    clean = {}
    for key in ("facePresence", "eyeContact", "cameraFacing", "lookingAway"):
        value = _number(raw.get(key))
        if value is not None:
            clean[key] = _clamp_percent(value)
    for key in ("multipleFaceEvents", "framesAnalyzed"):
        value = _number(raw.get(key))
        if value is not None:
            clean[key] = max(0, int(value))
    expressions = raw.get("expressions")
    if isinstance(expressions, dict):
        shares = {}
        for name, value in list(expressions.items())[:8]:
            number = _number(value)
            if number is not None:
                shares[str(name)[:20]] = _clamp_percent(number)
        if shares:
            clean["expressions"] = shares
    return clean or None


def average_score(values: Iterable, default: int = NEUTRAL_SCORE) -> int:
    """Rounded mean of the non-null values, or ``default`` when there are none."""
    numbers = [int(v) for v in values if v is not None]
    return round(sum(numbers) / len(numbers)) if numbers else default


def average_criteria(rows: Iterable[Optional[dict]]) -> Optional[dict]:
    """Per-criterion mean over answers that have criterion scores."""
    totals, counts = {}, {}
    for criteria in rows:
        if not isinstance(criteria, dict):
            continue
        for name, value in criteria.items():
            number = _number(value)
            if number is not None:
                totals[name] = totals.get(name, 0) + number
                counts[name] = counts.get(name, 0) + 1
    return {name: round(totals[name] / counts[name]) for name in totals} or None


def summarize_vision(rows: Iterable[Optional[dict]]) -> Optional[dict]:
    """Session view of per-answer vision metrics, with neutral integrity flags."""
    rows = [r for r in rows if isinstance(r, dict)]
    if not rows:
        return None

    def mean(key):
        values = [r[key] for r in rows if _number(r.get(key)) is not None]
        return round(sum(values) / len(values)) if values else None

    return {
        "answers_with_camera": len(rows),
        "eyeContact": mean("eyeContact"),
        "facePresence": mean("facePresence"),
        "cameraFacing": mean("cameraFacing"),
        "multipleFaceEvents": sum(int(r.get("multipleFaceEvents") or 0) for r in rows),
        "lowPresenceAnswers": sum(1 for r in rows if (_number(r.get("facePresence")) or 100) < LOW_FACE_PRESENCE),
    }


# -------------------------------------------------------------
# BLOCK 3: Overall score
# -------------------------------------------------------------
def applied_weights(answer_quality, communication, camera, fluency) -> dict:
    """Weights actually used after dropping components without data."""
    parts = {"answer_quality": answer_quality, "communication": communication,
             "camera_engagement": camera, "speech_fluency": fluency}
    used = {name: WEIGHTS[name] for name, value in parts.items() if value is not None}
    total = sum(used.values())
    return {name: round(weight / total, 3) for name, weight in used.items()}


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


# -------------------------------------------------------------
# BLOCK 4: Cross-module insights for strengths and improvements
# -------------------------------------------------------------
CRITERION_LABELS = {
    "correctness": "Correctness",
    "completeness": "Completeness",
    "technical_depth": "Technical depth",
    "relevance": "Relevance",
}


def insights(criteria: Optional[dict], speech: Optional[dict], vision: Optional[dict]) -> tuple[list, list]:
    """Return (strengths, improvements) derived from criteria, speech and camera."""
    strengths, improvements = [], []
    if criteria and len(criteria) > 1:
        ranked = sorted(criteria.items(), key=lambda item: item[1])
        weakest, strongest = ranked[0], ranked[-1]
        if strongest[1] >= 75:
            strengths.append(f"{CRITERION_LABELS.get(strongest[0], strongest[0])} was your strongest criterion ({strongest[1]}/100).")
        if weakest[1] < 70:
            improvements.append(f"{CRITERION_LABELS.get(weakest[0], weakest[0])} was your weakest criterion ({weakest[1]}/100).")
    if speech:
        wpm, fpm = speech.get("words_per_minute"), speech.get("fillers_per_minute")
        if wpm and wpm > 160:
            improvements.append(f"You spoke at {wpm} words per minute; slowing down would make answers easier to follow.")
        elif wpm and wpm < 110:
            improvements.append(f"You spoke at {wpm} words per minute; a slightly quicker pace would sound more fluent.")
        if fpm is not None and fpm > 3:
            improvements.append(f"About {fpm} filler words per minute; try pausing silently instead.")
        if speech.get("delivery_score") is not None and speech["delivery_score"] >= 85:
            strengths.append("Clear spoken delivery with a steady pace.")
    if vision:
        if vision.get("eyeContact") is not None and vision["eyeContact"] >= 75:
            strengths.append("Kept a consistent gaze toward the screen.")
        if vision.get("lowPresenceAnswers"):
            improvements.append("Your face was out of frame for part of some answers; check the camera position.")
    return strengths, improvements
