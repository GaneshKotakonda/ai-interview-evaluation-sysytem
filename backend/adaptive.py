"""Deterministic interview policy. No network or database dependencies."""

DIFFICULTIES = ("easy", "medium", "hard", "expert")


def determine_next_difficulty(current_difficulty, answer_score):
    index = DIFFICULTIES.index(current_difficulty)
    if not 0 <= answer_score <= 100:
        raise ValueError("answer_score must be between 0 and 100")
    change = 1 if answer_score >= 85 else -1 if answer_score < 50 else 0
    return DIFFICULTIES[max(0, min(len(DIFFICULTIES) - 1, index + change))]


def should_generate_follow_up(answer_score, previous_was_follow_up,
                              missing_concepts, strengths, evaluation_source="gemini"):
    # A specific gap AND demonstrated understanding are required. Approximate
    # offline scores cannot justify a personalized follow-up.
    return bool(
        50 <= answer_score < 70
        and not previous_was_follow_up
        and missing_concepts
        and strengths
        and evaluation_source == "gemini"
    )


def adaptation_for(response):
    score = response["answer_quality_score"]
    difficulty = determine_next_difficulty(response["difficulty"], score)
    follow_up = should_generate_follow_up(
        score, response["is_follow_up"], response["missing_concepts"],
        response["strengths"], response.get("evaluation_source", "gemini"),
    )
    reason = (
        "Probe a missing concept in an otherwise partially understood answer." if follow_up else
        "Strong technical coverage justified increasing difficulty." if score >= 85 and difficulty != response["difficulty"] else
        "Use a recovery concept question at the lowest permitted difficulty." if score < 50 else
        "Move to a new relevant topic at the selected difficulty."
    )
    return {
        "previous_difficulty": response["difficulty"],
        "next_difficulty": difficulty,
        "is_follow_up": follow_up,
        "reason": reason,
    }
