from datetime import datetime, timedelta, timezone

import assessment


NOW = datetime(2026, 10, 13, tzinfo=timezone.utc)


def response(**changes):
    return {"id": "response", "question_index": 2, "candidate_answer": "Binary search halves the search interval.",
            "submitted_at": NOW, "recording_part": 1, "answer_start_seconds": 10,
            "answer_end_seconds": 30, **changes}


def event(**changes):
    return {"id": "phone", "client_event_id": "phone-episode", "event_type": "phone_detected",
            "question_index": 2, "recording_part": 1, "at_seconds": 20,
            "created_at": NOW + timedelta(seconds=3), **changes}


def test_delayed_delivery_keeps_pre_submission_observation():
    row = event()
    assert assessment.events_for_response(response(), {"events": [row]}, strict_boundary=True) == [row]


def test_post_submission_and_other_question_events_excluded():
    rows = [event(at_seconds=31), event(question_index=3), event(recording_part=2),
            event(question_index=None), event(at_seconds=9)]
    assert assessment.events_for_response(response(), {"events": rows}, strict_boundary=True) == []


def test_untimed_events_require_server_receipt_before_submission():
    late = event(recording_part=None, at_seconds=None)
    early = event(recording_part=None, at_seconds=None, created_at=NOW - timedelta(seconds=1))
    assert assessment.events_for_response(response(), {"events": [late, early]}, strict_boundary=True) == [early]


def test_shared_assessment_applies_the_same_boundary_at_completion():
    result = assessment.assess_response(response(), {"events": [event(at_seconds=31)], "words": {}, "checks": []})
    assert not result["flags"]
    result = assessment.assess_response(response(), {"events": [event()], "words": {}, "checks": []})
    assert any(flag["code"] == "assistance_visible" for flag in result["flags"])


def test_legacy_assessment_preserves_prior_event_interpretation():
    result = assessment.assess_response(response(submitted_at=None, recording_part=None),
                                        {"events": [event()], "words": {}, "checks": []})
    assert result["action"] == "cap"


def test_preparation_episode_that_stays_visible_is_eligible():
    row = event(at_seconds=7)
    answer = response(observation_start_seconds=5)
    assert assessment.events_for_response(answer, {"events": [row]}, strict_boundary=True) == [row]
    assert assessment.events_for_response(answer, {"events": [event(at_seconds=4), event(at_seconds=31)]}, strict_boundary=True) == []


def test_arena_keeps_existing_delayed_event_penalty():
    result = assessment.assess_response(response(), {"events": [event(recording_part=None, at_seconds=None)],
                                        "words": {}, "checks": [], "interview_mode": "game"})
    assert result["action"] == "cap"
