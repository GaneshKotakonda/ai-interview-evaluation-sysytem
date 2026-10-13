"""A knowledge-verification question never removes the coding round."""
import adaptive_service


class CountCursor:
    def __init__(self, issued):
        self.issued = issued

    def execute(self, sql, args=None):
        self.sql = sql

    def fetchone(self):
        return {"issued": self.issued}


def interview(mode="standard", coding_round=True, max_turns=5):
    return {"id": "iv", "interview_mode": mode, "coding_round": coding_round, "max_turns": max_turns}


def test_scheduled_turns_unchanged_when_nothing_was_displaced():
    # Five turns: coding on 2 and 4.
    assert adaptive_service.coding_due(CountCursor(0), interview(), 2)
    assert not adaptive_service.coding_due(CountCursor(1), interview(), 3)
    assert adaptive_service.coding_due(CountCursor(1), interview(), 4)
    assert not adaptive_service.coding_due(CountCursor(2), interview(), 5)


def test_coding_displaced_by_verification_moves_to_the_next_turn():
    # Turn 2 became a verification question, so no coding was issued yet.
    assert adaptive_service.coding_due(CountCursor(0), interview(), 3)
    # Turn 4 was taken too: the second coding question moves to turn 5.
    assert adaptive_service.coding_due(CountCursor(1), interview(), 5)


def test_arena_and_no_coding_round_keep_fixed_rules():
    arena = interview(mode="game", max_turns=6)  # Arena coding turns: 3 and 5
    assert not adaptive_service.coding_due(CountCursor(0), arena, 4)
    assert adaptive_service.coding_due(CountCursor(0), arena, 5)
    assert not adaptive_service.coding_due(CountCursor(0), interview(coding_round=False), 2)


def test_unknown_count_falls_back_to_the_schedule():
    class Empty(CountCursor):
        def fetchone(self):
            return None
    assert adaptive_service.coding_due(Empty(0), interview(), 2)
    assert not adaptive_service.coding_due(Empty(0), interview(), 3)
