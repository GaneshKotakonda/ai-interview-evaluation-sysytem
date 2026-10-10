"""Per-answer malpractice assessment, score penalties and the verdict.

Pure functions (no I/O), so every rule is unit-testable.

For each answer the evidence is combined into flags:
  zero    another person gave the answer (voice did not match the
          enrolled candidate, or a different face was confirmed on camera)
          -> the answer scores 0;
  cap     the answer was assisted (another voice in part of it, reading a
          prepared/AI-generated text, a phone or another person visible,
          text injected into the typed answer) -> the answer is capped at
          ASSISTED_CAP;
  review  a weaker signal worth a human look; no penalty.

The interview verdict is clean, review or invalid. Invalid (the identity
of the candidate cannot be trusted) sets the overall score to 0; the score
before integrity adjustments is kept in the report for reviewers.

Reading detection never relies on one signal: "high" needs evidence from at
least two independent families (speech rhythm, eye movements, content
style, response latency). Whisper adds punctuation wherever a speaker
pauses, so "pausing at commas" is deliberately not used as a signal.
"""
import math
import re
from typing import Optional

ASSISTED_CAP = 40

# -------------------------------------------------------------
# BLOCK 1: Browser signals sent with each answer
# -------------------------------------------------------------
_SIGNAL_FIELDS = {
    "gaze": ("speaking_ms", "sweeps", "offscreen_ms", "samples"),
    "lip_sync": ("voiced_ms", "voiced_mouth_still_ms", "longest_still_ms"),
    "typing": ("keystrokes", "chars", "largest_insert", "untrusted_inputs", "active_ms"),
}
_SIGNAL_LIMIT = 24 * 60 * 60 * 1000


def _number(value, limit=_SIGNAL_LIMIT) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return max(0.0, min(float(value), limit))


def sanitize_signals(raw) -> Optional[dict]:
    """Keep only known, finite, non-negative numbers from the browser."""
    if not isinstance(raw, dict):
        return None
    clean = {}
    latency = _number(raw.get("latency_seconds"), 3600)
    if latency is not None:
        clean["latency_seconds"] = round(latency, 1)
    for group, fields in _SIGNAL_FIELDS.items():
        values = raw.get(group)
        if isinstance(values, dict):
            numbers = {field: _number(values.get(field)) for field in fields}
            numbers = {field: round(value) for field, value in numbers.items() if value is not None}
            if numbers:
                clean[group] = numbers
    return clean or None


# -------------------------------------------------------------
# BLOCK 2: Reading a prepared / AI-generated answer
# -------------------------------------------------------------
# Phrases far more common in AI-generated text than in spontaneous speech.
AI_PHRASES = (
    "delve", "it's important to note", "it is important to note", "in conclusion", "in summary",
    "furthermore", "moreover", "additionally", "leverage", "leveraging", "seamless", "seamlessly",
    "robust", "a crucial role", "plays a vital role", "plays a key role", "in today's",
    "overall,", "firstly", "secondly", "thirdly", "lastly", "ensuring that", "facilitate",
    "comprehensive", "utilize", "utilizing", "paradigm", "holistic", "streamline",
)
_WORD = re.compile(r"[a-z']+")


def ai_phrase_count(text: str) -> int:
    lowered = (text or "").casefold()
    return sum(lowered.count(phrase) for phrase in AI_PHRASES)


def repetition_count(words: list[dict]) -> int:
    """Immediate word repeats ("I, I think", "the the"): common when speaking freely."""
    tokens = [_WORD.findall(w["word"].casefold()) for w in words or []]
    tokens = [t[0] for t in tokens if t]
    return sum(1 for a, b in zip(tokens, tokens[1:]) if a == b)


def reading_assessment(words: Optional[list], text: str, speech: Optional[dict],
                       signals: Optional[dict], content: Optional[dict]) -> dict:
    """Likelihood that the answer was read out or copied from a prepared text.

    Returns ``{level: low|medium|high, score 0-100, families: [...], evidence: [...]}``.
    """
    signals = signals or {}
    evidence, families, score = [], [], 0
    word_count = len(words or []) or len(_WORD.findall((text or "").casefold()))

    # Speech rhythm (spoken answers with word timings only).
    if speech and speech.get("word_count", 0) >= 40 and speech.get("speaking_seconds", 0) >= 20:
        points = 0
        if speech.get("fillers_per_minute", 99) <= 0.5:
            points += 12
            evidence.append("No filler words across a long spoken answer.")
        if words and repetition_count(words) == 0:
            points += 8
            evidence.append("No self-corrections or repeated words.")
        minutes = speech["speaking_seconds"] / 60
        if speech.get("words_per_minute", 0) >= 140 and speech.get("long_pauses", 0) / minutes < 0.5:
            points += 10
            evidence.append(f"Fast, uninterrupted delivery ({speech['words_per_minute']} words/min, no thinking pauses).")
        if points:
            score += min(points, 30)
            families.append("speech")

    # Eye movements while speaking: reading produces repeated line sweeps.
    gaze = signals.get("gaze") or {}
    if gaze.get("speaking_ms", 0) >= 15000:
        minutes = gaze["speaking_ms"] / 60000
        sweeps_per_min = gaze.get("sweeps", 0) / minutes
        offscreen = gaze.get("offscreen_ms", 0) / gaze["speaking_ms"]
        points = 0
        if sweeps_per_min >= 6:
            points += 30
        elif sweeps_per_min >= 3:
            points += 15
        if points:
            evidence.append(f"Eye movements matched reading lines of text ({sweeps_per_min:.1f} line sweeps per minute).")
        if offscreen >= 0.5:
            points += 15
        elif offscreen >= 0.3:
            points += 8
        if offscreen >= 0.3:
            evidence.append(f"Looked away from the screen for {round(offscreen * 100)}% of the answer.")
        if points:
            score += min(points, 35)
            families.append("gaze")

    # Content style (Gemini's judgement plus phrase markers).
    points = 0
    likelihood = (content or {}).get("scripted_likelihood")
    if isinstance(likelihood, (int, float)):
        if likelihood >= 75:
            points += 30
        elif likelihood >= 55:
            points += 15
        if likelihood >= 55:
            reasons = "; ".join((content or {}).get("scripted_signals") or [])[:200]
            evidence.append("Wording reads like a prepared or AI-generated text" + (f": {reasons}." if reasons else "."))
    phrases = ai_phrase_count(text)
    if word_count and phrases >= 3 and phrases * 100 / word_count >= 1.5:
        points += 10
        evidence.append(f"{phrases} phrases typical of AI-generated text.")
    if points:
        score += min(points, 35)
        families.append("content")

    # A long silence, then a long, fluent answer.
    latency = signals.get("latency_seconds")
    if latency is not None and latency >= 8 and word_count >= 60 and (
            not speech or speech.get("fillers_per_minute", 99) <= 1):
        score += 10
        families.append("latency")
        evidence.append(f"{round(latency)} s of silence before a long, fluent answer.")

    score = min(100, score)
    level = "high" if score >= 55 and len(families) >= 2 else "medium" if score >= 30 else "low"
    return {"level": level, "score": score, "families": families, "evidence": evidence}


# -------------------------------------------------------------
# BLOCK 3: One answer
# -------------------------------------------------------------
FLAG_LABELS = {
    "voice_mismatch": "Answered in a voice that does not match the candidate",
    "face_mismatch": "A different person was on camera during this answer",
    "other_voice": "Another voice was heard during this answer",
    "reading": "Likely reading a prepared or AI-generated answer",
    "reading_possible": "Possibly reading a prepared answer",
    "assistance_visible": "Another person or a phone was visible during this answer",
    "text_injected": "Text was inserted into the answer without typing",
    "voice_uncertain": "Voice match was inconclusive",
}

# Live events that mark an answer as assisted.
ASSISTANCE_EVENTS = {"extra_person", "phone_detected"}


def _flag(code: str, severity: str, detail: Optional[str] = None) -> dict:
    flag = {"code": code, "label": FLAG_LABELS[code], "severity": severity}
    if detail:
        flag["detail"] = detail
    return flag


def typing_injected(typing: Optional[dict]) -> bool:
    """Text that appeared faster than it was typed (auto-typers, scripts, dictation tools)."""
    if not typing:
        return False
    if typing.get("untrusted_inputs", 0) > 0 or typing.get("largest_insert", 0) >= 25:
        return True
    chars = typing.get("chars", 0)
    return chars >= 80 and typing.get("keystrokes", 0) < chars * 0.5


def assess_answer(*, voice_check: Optional[dict], face_mismatch: bool, events: list[str],
                  signals: Optional[dict], reading: dict) -> dict:
    """Flags for one answer and the penalty they imply (``zero``, ``cap`` or None)."""
    signals = signals or {}
    flags = []
    voice = (voice_check or {}).get("verdict")
    if voice == "mismatch":
        flags.append(_flag("voice_mismatch", "zero", f"Voice similarity {voice_check.get('similarity')}"))
    elif voice == "mixed":
        segments = voice_check.get("other_voice_segments") or []
        detail = ", ".join(f"{s['start']:.0f}-{s['end']:.0f}s" for s in segments[:4])
        flags.append(_flag("other_voice", "cap", f"At {detail} of the answer" if detail else None))
    elif voice == "uncertain":
        flags.append(_flag("voice_uncertain", "review", f"Voice similarity {voice_check.get('similarity')}"))
    if face_mismatch:
        flags.append(_flag("face_mismatch", "zero"))
    if "other_voice" in events and not any(f["code"] == "other_voice" for f in flags):
        flags.append(_flag("other_voice", "cap", "Speech was heard while the candidate's lips were not moving"))
    lip = signals.get("lip_sync") or {}
    if (lip.get("voiced_mouth_still_ms", 0) >= 5000 and lip.get("voiced_ms", 0)
            and lip["voiced_mouth_still_ms"] / lip["voiced_ms"] >= 0.4
            and not any(f["code"] == "other_voice" for f in flags)):
        flags.append(_flag("other_voice", "cap", "Speech was heard while the candidate's lips were not moving"))
    if ASSISTANCE_EVENTS & set(events):
        flags.append(_flag("assistance_visible", "cap"))
    if typing_injected(signals.get("typing")) or "text_injected" in events:
        flags.append(_flag("text_injected", "cap"))
    if reading["level"] == "high":
        flags.append(_flag("reading", "cap", " ".join(reading["evidence"])[:400]))
    elif reading["level"] == "medium":
        flags.append(_flag("reading_possible", "review", " ".join(reading["evidence"])[:400]))

    severities = {f["severity"] for f in flags}
    action = "zero" if "zero" in severities else "cap" if "cap" in severities else None
    return {"flags": flags, "action": action, "reading": reading}


def apply_penalty(evaluation: dict, assessment: dict) -> dict:
    """Return a copy of a per-answer evaluation with the integrity penalty applied."""
    action = assessment.get("action")
    if action not in ("zero", "cap"):
        return dict(evaluation)

    def penalise(value):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return value
        return 0 if action == "zero" else min(int(value), ASSISTED_CAP)

    adjusted = dict(evaluation)
    for key in ("answer_quality_score", "communication_score"):
        adjusted[key] = penalise(adjusted.get(key))
    if isinstance(adjusted.get("criteria_scores"), dict):
        adjusted["criteria_scores"] = {k: penalise(v) for k, v in adjusted["criteria_scores"].items()}
    return adjusted


# -------------------------------------------------------------
# BLOCK 4: The interview verdict
# -------------------------------------------------------------
def verdict(assessments: list[dict], face_mismatch_episodes: int, integrity_level: str,
            answered: int) -> dict:
    """``{verdict: clean|review|invalid, reasons: [...]}`` for the whole interview."""
    voice_mismatches = sum(1 for a in assessments if any(f["code"] == "voice_mismatch" for f in a["flags"]))
    zeroed = sum(1 for a in assessments if a.get("action") == "zero")
    capped = sum(1 for a in assessments if a.get("action") == "cap")
    reviews = sum(1 for a in assessments if any(f["severity"] == "review" for f in a["flags"]))

    reasons = []
    invalid = (face_mismatch_episodes >= 2 or voice_mismatches >= 2
               or (face_mismatch_episodes >= 1 and voice_mismatches >= 1)
               or (answered and zeroed >= math.ceil(answered / 2)))
    if face_mismatch_episodes:
        reasons.append(f"A different person was seen on camera {face_mismatch_episodes} time(s).")
    if voice_mismatches:
        reasons.append(f"{voice_mismatches} answer(s) were given in a voice that is not the candidate's.")
    if capped:
        reasons.append(f"{capped} answer(s) showed signs of assistance and were capped at {ASSISTED_CAP}.")
    if reviews:
        reasons.append(f"{reviews} answer(s) have weaker signals worth reviewing.")
    if integrity_level == "flagged":
        reasons.append("Repeated proctoring violations.")

    if invalid:
        result = "invalid"
        reasons.insert(0, "The candidate's identity could not be confirmed throughout the interview.")
    elif zeroed or capped or reviews or integrity_level == "flagged":
        result = "review"
    else:
        result = "clean"
    return {"verdict": result, "reasons": reasons, "answers_zeroed": zeroed, "answers_capped": capped}
