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
