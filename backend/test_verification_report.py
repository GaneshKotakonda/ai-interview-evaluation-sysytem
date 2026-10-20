import verification_report


class Rows:
    def __init__(self, questions, events):
        self.questions, self.events = questions, events

    def execute(self, sql, args):
        self.is_question = "FROM interview_questions" in sql

    def fetchall(self):
        return self.questions if self.is_question else self.events


def test_derived_evidence_links_have_timeline_destinations():
    question = {"question_index": 3, "question_text": "Trace a concrete example.",
                "verification_meta": {"parent_question_index": 2, "evidence_ids": ["response:r:reading:gaze"],
                                      "evidence_codes": ["reading_gaze", "reading_content"],
                                      "generated_at": "2026-10-13T00:01:00+00:00"}, "verification_result": None}
    report = verification_report.build(Rows([question], []), {"id": "interview", "created_at": "2026-10-13T00:00:00+00:00"})
    evidence = report["details"][0]["evidence"]
    assert {e["id"] for e in evidence} <= {e["id"] for e in report["timeline"]}
    assert report["challenges"] == 1 and report["passed"] == 0


def test_old_interviews_normalize_empty_verification_summary():
    assert verification_report.counts(None) == {"challenges": 0, "passed": 0, "partial": 0, "failed": 0}
    report = verification_report.build(Rows([], []), {"id": "old"})
    assert report["details"] == [] and report["timeline"] == []


def test_timeline_orders_by_instant_across_time_zones():
    # The database returns event times in its own zone (+05:30 here); the
    # verification is stamped in UTC one minute after the phone was seen.
    from datetime import datetime, timedelta, timezone
    ist = timezone(timedelta(hours=5, minutes=30))
    event = {"id": 1, "client_event_id": "phone-1", "event_type": "phone_detected", "question_index": 2,
             "recording_part": 1, "at_seconds": 40.0, "duration_seconds": 3.0,
             "created_at": datetime(2026, 10, 13, 15, 0, tzinfo=ist)}  # 09:30 UTC
    question = {"question_index": 3, "question_text": "Trace a concrete example.",
                "verification_meta": {"parent_question_index": 2, "evidence_ids": ["phone-1"],
                                      "evidence_codes": ["phone_detected"],
                                      "generated_at": "2026-10-13T09:31:00+00:00"},
                "verification_result": None}
    report = verification_report.build(Rows([question], [event]),
                                       {"id": "interview", "created_at": datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc)})
    assert [e["id"] for e in report["timeline"]] == ["phone-1", "verification-3"]
