"""Conservative issuance policy, independent of sensors and model calls."""
import importlib
import importlib.util
from datetime import datetime, timezone

import pytest


def module():
    assert importlib.util.find_spec("counter_cheating") is not None, "Counter-cheating policy is not implemented"
    return importlib.import_module("counter_cheating")


def response(**changes):
    return {"id": "answer-3", "question_index": 3, "kind": "spoken",
            "candidate_answer": "A substantive explanation of the algorithm and its practical limitations.",
            "answer_quality_score": 90, "evaluation_source": "gemini", **changes}


def assessment(families=(), level="low", flags=()):
    return {"flags": [{"code": code} for code in flags],
            "reading": {"level": level, "families": list(families), "evidence": []}}


def event(kind="phone_detected", identity="phone-episode", **changes):
    return {"event_type": kind, "client_event_id": identity, "id": "db-" + identity,
            "question_index": 3, "created_at": "2026-10-13T12:02:00Z", **changes}


def decision(answer=None, assessed=None, events=(), history=(), challenges=(), **changes):
    options = {"interview_mode": "standard", "current_turn": 3, "max_turns": 6, **changes}
    return module().decide(answer or response(), assessed or assessment(), list(events),
                           list(history), list(challenges), **options)


@pytest.mark.parametrize("assessed,events,history,score", [
    (assessment(), [], [], 0),
    (assessment(["gaze"], "medium"), [], [], 30),
    (assessment(["latency"], "medium"), [], [], 10),
    (assessment(), [event("tab_hidden")], [], 35),
    (assessment(), [], [response(id="answer-2", question_index=2, answer_quality_score=50)], 15),
    (assessment(["content", "latency"], "high"), [], [], 40),
])
def test_single_behavioral_or_performance_family_does_not_issue(assessed, events, history, score):
    result = decision(assessed=assessed, events=events, history=history)
    assert result["trigger_verification"] is False
    assert result["risk_score"] == score
    assert result["policy_version"] == "counter_cheating_v1"


@pytest.mark.parametrize("kind,flag,family", [
    ("phone_detected", "assistance_visible", "scene"),
    ("extra_person", "assistance_visible", "scene"),
    ("other_voice", "other_voice", "audio"),
    ("text_injected", "text_injected", "typing"),
])
def test_direct_assistance_issues_with_stable_event_ids(kind, flag, family):
    result = decision(assessed=assessment(flags=[flag]), events=[event(kind)])
    assert result["trigger_verification"] is True
    assert result["risk_score"] == 70
    assert result["high_confidence_trigger"] is True
    assert result["signal_families"] == [family]
    assert "phone-episode" in result["evidence_ids"]


@pytest.mark.parametrize("flag", ["other_voice", "text_injected"])
def test_assessed_direct_answer_signals_have_response_scoped_ids(flag):
    first = decision(assessed=assessment(flags=[flag]))
    retry = decision(assessed=assessment(flags=[flag]))
    assert first["trigger_verification"] is True
    assert first["evidence_ids"] == retry["evidence_ids"]
    assert any("answer-3" in identity for identity in first["evidence_ids"])


def test_medium_independent_reading_families_reach_threshold():
    result = decision(assessed=assessment(["gaze", "content"], "medium"))
    assert result["trigger_verification"] is True
    assert result["risk_score"] == 60
    assert result["high_confidence_trigger"] is False


def test_high_reading_requires_two_substantive_families_for_minimum_70():
    result = decision(assessed=assessment(["speech", "content", "latency"], "high"))
    assert result["trigger_verification"] is True
    assert result["risk_score"] == 70
    assert result["high_confidence_trigger"] is True


def test_browser_plus_eligible_content_family_issues():
    result = decision(assessed=assessment(["content"], "medium"), events=[event("window_blur")])
    assert result["risk_score"] == 65
    assert result["trigger_verification"] is True


def test_same_family_is_not_counted_twice_and_performance_uses_maximum():
    result = decision(assessed=assessment(["content", "content", "latency"], "medium"),
                      events=[event("tab_hidden", "one"), event("window_blur", "two")],
                      history=[response(id="old", question_index=2, answer_quality_score=50)])
    assert result["risk_score"] == 80  # 35 browser + 30 content + max(15, 10)
    assert result["family_weights"]["performance"] == 15
    assert result["signal_families"].count("content") == 1


def test_low_reading_does_not_gain_weights_from_advisories():
    result = decision(assessed=assessment(["gaze", "content"], "low"), events=[event("looking_away")])
    assert result["risk_score"] == 0
    assert result["trigger_verification"] is False


def test_existing_long_fluent_latency_is_supporting_evidence_even_in_low_reading():
    result = decision(assessed=assessment(["latency"], "low"))
    assert result["risk_score"] == 10
    assert result["trigger_verification"] is False


def test_identity_mismatch_remains_outside_assistance_decision():
    result = decision(assessed=assessment(flags=["face_mismatch", "voice_mismatch"]),
                      events=[event("face_mismatch"), event("voice_mismatch", "voice")])
    assert result["risk_score"] == 0
    assert result["trigger_verification"] is False


@pytest.mark.parametrize("changes,reason", [
    ({"interview_mode": "game"}, "interview_mode"),
    ({"interview_mode": None}, "interview_mode"),
    ({"current_turn": 6}, "final_turn"),
    ({"settings": {"enabled": False}}, "disabled"),
])
def test_policy_suppression_retains_risk(changes, reason):
    result = decision(events=[event()], **changes)
    assert result["trigger_verification"] is False
    assert result["risk_score"] == 70
    assert result["suppression_reason"] == reason


def test_challenge_cap_and_one_per_response():
    challenges = [{"verification_meta": {"parent_response_id": "old-1"}},
                  {"verification_meta": {"parent_response_id": "old-2"}}]
    assert decision(events=[event()], challenges=challenges)["suppression_reason"] == "challenge_limit"
    own = [{"verification_meta": {"parent_response_id": "answer-3"}}]
    assert decision(events=[event()], challenges=own)["suppression_reason"] == "already_challenged"


def test_consumed_scene_episode_does_not_survive_through_assessed_flag():
    challenges = [{"verification_meta": {"parent_response_id": "old", "evidence_ids": ["phone-episode"]}}]
    result = decision(events=[event(duration_seconds=10)],
                      assessed=assessment(flags=["assistance_visible"]), challenges=challenges)
    assert result["risk_score"] == 0
    assert result["trigger_verification"] is False


def test_consumed_derived_answer_evidence_is_not_reused():
    first = decision(assessed=assessment(flags=["other_voice"]))
    challenge = {"verification_meta": {"parent_response_id": "old", "evidence_ids": first["evidence_ids"]}}
    second = decision(assessed=assessment(flags=["other_voice"]), challenges=[challenge])
    assert second["trigger_verification"] is False
    assert second["risk_score"] == 0


@pytest.mark.parametrize("stamp,expected", [
    ("2026-10-13T12:00:00Z", False),
    ("2026-10-13T12:01:00+00:00", False),
    (datetime(2026, 10, 13, 12, 2, tzinfo=timezone.utc), True),
])
def test_verification_turn_requires_severe_event_after_previous_generation(stamp, expected):
    previous = {"kind": "verify", "verification_meta": {"parent_response_id": "answer-2",
                "generated_at": "2026-10-13T12:01:00Z"}}
    result = decision(answer=response(kind="verify"), question=previous, challenges=[previous],
                      events=[event(created_at=stamp)])
    assert result["trigger_verification"] is expected
    if not expected:
        assert result["suppression_reason"] == "verification_cooldown"


def test_verification_turn_blocks_derived_direct_flags_and_reading_chain():
    previous = {"kind": "verify", "verification_meta": {"generated_at": "2026-10-13T12:01:00Z"}}
    result = decision(answer=response(kind="verify"), question=previous,
                      assessed=assessment(["speech", "content"], "high", ["other_voice"]))
    assert result["trigger_verification"] is False
    assert result["suppression_reason"] == "verification_cooldown"


def test_score_history_uses_last_three_substantive_comparable_ordinary_answers():
    history = [response(id="older", question_index=0, answer_quality_score=0),
               response(id="a", question_index=1, answer_quality_score=80),
               response(id="b", question_index=2, answer_quality_score=80),
               response(id="c", question_index=2, answer_quality_score=80),
               response(id="verify", question_index=2, kind="verify", answer_quality_score=0),
               response(id="empty", question_index=2, evaluation_source="empty", candidate_answer=""),
               response(id="coding", question_index=2, kind="coding", answer_quality_score=0),
               response(id="fallback", question_index=2, evaluation_source="fallback", answer_quality_score=0)]
    assert decision(history=history)["risk_score"] == 0


def test_performance_cannot_supply_the_second_independent_behavioral_family():
    result = decision(events=[event("tab_hidden")],
                      assessed=assessment(["latency"], "medium"),
                      history=[response(id="old", question_index=2, answer_quality_score=40)],
                      settings={"threshold": 40})
    assert result["risk_score"] == 50
    assert result["trigger_verification"] is False


def test_legacy_non_answer_is_excluded_even_with_a_grading_source():
    history = [response(id="non-answer", question_index=2, candidate_answer="I don't know", answer_quality_score=0)]
    assert decision(history=history)["risk_score"] == 0


def test_invalid_settings_fall_back_and_threshold_never_below_60():
    assert decision(assessed=assessment(["gaze", "content"], "medium"),
                    settings={"threshold": "bad", "max_challenges": "bad", "enabled": "bad"})["trigger_verification"] is True
    assert decision(assessed=assessment(["gaze", "content"], "medium"),
                    settings={"threshold": 99})["trigger_verification"] is False


@pytest.mark.parametrize("score,status", [(70, "passed"), (69, "partial"), (50, "partial"), (49, "failed"), (0, "failed")])
def test_verification_result_uses_normal_raw_grade(score, status):
    question = {"kind": "verify", "verification_meta": {"verification_target": "binary search bounds",
                "parent_question_index": 2}}
    result = module().verification_result(question, response(answer_quality_score=score, evaluated_at="2026-10-13T12:05:00Z"))
    assert result == {"status": status, "score": score, "target": "binary search bounds",
                      "parent_question_index": 2, "evaluated_at": "2026-10-13T12:05:00Z"}


def test_ordinary_question_has_no_verification_result():
    assert module().verification_result({"kind": "spoken"}, response()) is None
