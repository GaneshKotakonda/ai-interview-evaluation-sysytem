"""Deterministic, conservative knowledge-verification issuance policy.

The caller supplies stored events that satisfy the immutable answer boundary
and the existing malpractice assessment. This policy does no grading, sensor
inference or model-based cheating classification.
"""
from datetime import datetime, timezone
import math

import config
import scoring

POLICY_VERSION = "counter_cheating_v1"
DIRECT_EVENTS = {"phone_detected": "scene", "extra_person": "scene",
                 "other_voice": "audio", "text_injected": "typing"}
BROWSER_EVENTS = {"tab_hidden", "window_blur", "fullscreen_exit"}
READING_FAMILIES = {"gaze", "speech", "content"}
WEIGHTS = {"direct": 70, "browser": 35, "reading": 30,
           "score_increase": 15, "fluent_latency": 10}


def _timestamp(value):
    """Normalise PostgreSQL datetimes and ISO timestamps to aware UTC."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) and 0 <= value <= 100 else None


def _bool(value, default=True):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.strip().lower() in {"true", "1", "on", "yes"}:
            return True
        if value.strip().lower() in {"false", "0", "off", "no"}:
            return False
    return default


def _int(value, default, minimum, maximum):
    try:
        if isinstance(value, bool):
            return default
        value = int(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(minimum, min(value, maximum))


def _settings(settings):
    values = settings if isinstance(settings, dict) else {}
    return {
        "enabled": _bool(values.get("enabled", config.COUNTER_CHEATING_ENABLED)),
        "threshold": _int(values.get("threshold", config.COUNTER_CHEATING_THRESHOLD), 60, 60, 100),
        "max_challenges": _int(values.get("max_challenges", config.COUNTER_CHEATING_MAX_CHALLENGES), 2, 0, 2),
    }


def _meta(challenge):
    metadata = challenge.get("verification_meta") if isinstance(challenge, dict) else None
    return metadata if isinstance(metadata, dict) else {}


def _modality(response, question=None):
    if response.get("kind") == "coding" or (question or {}).get("kind") == "coding" or response.get("coding_result"):
        return "coding"
    if response.get("transcript") or response.get("audio_path") or response.get("speech_metrics"):
        return "spoken"
    return "typed"


def _substantive(response):
    return (scoring.is_substantive(response)
            and _score(response.get("answer_quality_score")) is not None)


def _score_increase(response, recent_responses, question):
    score = _score(response.get("answer_quality_score"))
    if score is None or score < 85 or not _substantive(response):
        return False
    current_index = response.get("question_index")
    source = response.get("evaluation_source")
    modality = _modality(response, question)
    comparable = []
    for old in recent_responses:
        if not isinstance(old, dict) or old.get("id") == response.get("id"):
            continue
        if old.get("kind") == "verify" or old.get("verification_meta") or old.get("verification_result"):
            continue
        if old.get("evaluation_source") != source or _modality(old) != modality or not _substantive(old):
            continue
        index = old.get("question_index")
        if not isinstance(index, int) or not isinstance(current_index, int) or index >= current_index:
            continue
        comparable.append(old)
    comparable.sort(key=lambda item: item["question_index"], reverse=True)
    scores = [float(item["answer_quality_score"]) for item in comparable[:3]]
    return bool(scores) and score - sum(scores) / len(scores) >= 30


def decide(response, assessed, events, recent_responses, challenges, *,
           interview_mode, current_turn, max_turns, question=None, settings=None):
    """Fuse evidence and explain whether this scheduled turn should verify.

    Event IDs use the immutable client ID where available, otherwise the
    stored row ID. Derived evidence is response-scoped. Every decision is
    versioned, including suppressed decisions and clean responses.
    """
    policy = _settings(settings)
    response, assessed = response or {}, assessed or {}
    question = question or {}
    challenges = [item for item in challenges or [] if _meta(item)]
    consumed = set()
    for challenge in challenges:
        metadata = _meta(challenge)
        for key in ("evidence_ids", "consumed_event_ids", "consumed_signal_ids"):
            ids = metadata.get(key) or []
            if isinstance(ids, list):
                consumed.update(str(identity) for identity in ids)

    original_events = [event for event in events or [] if isinstance(event, dict)
                       and event.get("question_index") is not None
                       and event.get("question_index") == response.get("question_index")]
    available_events = []
    for event in original_events:
        identity = event.get("client_event_id") or event.get("id")
        if identity is None:
            continue
        identities = {str(value) for value in (identity, event.get("id")) if value is not None}
        if not identities & consumed:
            available_events.append((event, str(identity)))

    weights, codes, ids = {}, [], []

    def add(family, weight, code, identity):
        if identity in consumed:
            return
        weights[family] = max(weights.get(family, 0), weight)
        if code not in codes:
            codes.append(code)
        if identity not in ids:
            ids.append(identity)

    direct = False
    direct_new_episode = False
    generated_at = _timestamp(_meta(question).get("generated_at"))
    for event, identity in available_events:
        kind = event.get("event_type")
        if kind in DIRECT_EVENTS:
            add(DIRECT_EVENTS[kind], WEIGHTS["direct"], kind, identity)
            direct = True
            observed = _timestamp(event.get("observed_at") or event.get("created_at"))
            if generated_at and observed and observed > generated_at:
                direct_new_episode = True
        elif kind in BROWSER_EVENTS:
            add("browser", WEIGHTS["browser"], kind, identity)

    response_id = str(response.get("id") or f"question-{response.get('question_id')}:{response.get('question_index')}")
    flags = {flag.get("code") for flag in assessed.get("flags", []) if isinstance(flag, dict)}
    original_kinds = {event.get("event_type") for event in original_events}
    for code, family in (("other_voice", "audio"), ("text_injected", "typing")):
        # A stored event's flag is not independent evidence. In particular,
        # filtering its consumed ID must also remove the assessed flag's risk.
        if code in flags and code not in original_kinds:
            identity = f"response:{response_id}:{code}"
            if identity not in consumed:
                add(family, WEIGHTS["direct"], code, identity)
                direct = True

    reading = assessed.get("reading") or {}
    reading_families = set()
    if reading.get("level") in {"medium", "high"}:
        for family in reading.get("families") or []:
            identity = f"response:{response_id}:reading:{family}"
            if family in READING_FAMILIES and identity not in consumed:
                add(family, WEIGHTS["reading"], f"reading_{family}", identity)
                reading_families.add(family)
    if "latency" in (reading.get("families") or []):
        add("performance", WEIGHTS["fluent_latency"], "fluent_long_latency", f"response:{response_id}:reading:latency")
    if _score_increase(response, recent_responses or [], question):
        add("performance", WEIGHTS["score_increase"], "score_increase", f"response:{response_id}:score_increase")

    high_reading = reading.get("level") == "high" and len(reading_families) >= 2
    risk = min(100, sum(weights.values()))
    if high_reading:
        risk = max(70, risk)
    high_confidence = direct or high_reading
    substantive_families = set(weights) - {"performance"}
    due = high_confidence or (risk >= policy["threshold"] and len(substantive_families) >= 2)

    suppression = None
    if not policy["enabled"]:
        suppression = "disabled"
    elif interview_mode != "standard":
        suppression = "interview_mode"
    elif current_turn >= max_turns:
        suppression = "final_turn"
    elif any(str(_meta(challenge).get("parent_response_id")) == str(response.get("id")) for challenge in challenges):
        suppression = "already_challenged"
    elif len(challenges) >= policy["max_challenges"]:
        suppression = "challenge_limit"
    elif (question.get("kind") == "verify" or response.get("kind") == "verify") and not direct_new_episode:
        suppression = "verification_cooldown"

    trigger = bool(due and suppression is None)
    if trigger:
        reason = "Possible assistance detected; verify a specific claim from the previous answer."
    elif suppression:
        reason = "Evidence retained for review; knowledge verification suppressed by " + suppression.replace("_", " ") + "."
    else:
        reason = "Evidence does not meet the conservative knowledge-verification policy."
    families = list(weights)
    return {"policy_version": POLICY_VERSION, "risk_score": risk,
            "risk_level": "high" if risk >= 60 else "moderate" if risk >= 30 else "low",
            "signal_families": families, "families": families, "family_weights": weights,
            "evidence_codes": codes, "evidence_ids": ids,
            "high_confidence_trigger": high_confidence, "high_confidence": high_confidence,
            "trigger_verification": trigger, "should_verify": trigger,
            "suppression_reason": suppression, "reason": reason, "internal_reason": reason}


def verification_result(question, response):
    """Return the verification outcome from its normal unadjusted grade."""
    if (question or {}).get("kind") != "verify":
        return None
    score = _score((response or {}).get("answer_quality_score"))
    if score is None:
        return None
    metadata = _meta(question)
    evaluated = (response or {}).get("evaluated_at")
    if isinstance(evaluated, datetime):
        evaluated = evaluated.isoformat()
    return {"status": "passed" if score >= 70 else "partial" if score >= 50 else "failed",
            "score": int(score) if score.is_integer() else score,
            "target": metadata.get("verification_target") or metadata.get("target"),
            "parent_question_index": metadata.get("parent_question_index"),
            "evaluated_at": evaluated}
