"""Deterministic interview policy. No network or database dependencies.

The language model never decides difficulty or follow-ups; these rules do,
so the same answer score always leads to the same next step.

| Answer score | Next action                                        |
| ------------ | -------------------------------------------------- |
| 85-100       | Raise difficulty one level                         |
| 70-84        | Keep difficulty, move to a new topic               |
| 50-69        | Keep difficulty; one follow-up allowed if eligible |
| 0-49         | Lower difficulty one level (recovery question)     |
"""

DIFFICULTIES = ("easy", "medium", "hard", "expert")


# -------------------------------------------------------------
# BLOCK 1: Difficulty transitions
# -------------------------------------------------------------
def determine_next_difficulty(current_difficulty, answer_score):
    """Return the difficulty for the next turn, clamped to easy..expert."""
    index = DIFFICULTIES.index(current_difficulty)
    if not 0 <= answer_score <= 100:
        raise ValueError("answer_score must be between 0 and 100")
    change = 1 if answer_score >= 85 else -1 if answer_score < 50 else 0
    return DIFFICULTIES[max(0, min(len(DIFFICULTIES) - 1, index + change))]


# -------------------------------------------------------------
# BLOCK 2: Follow-up eligibility
# -------------------------------------------------------------
def should_generate_follow_up(answer_score, previous_was_follow_up,
                              missing_concepts, strengths, evaluation_source="gemini"):
    """True only for a partial (50-69) answer with a named gap.

    Also requires demonstrated strengths, a real Gemini evaluation (approximate
    offline scores cannot justify a personalised probe) and that the previous
    question was not itself a follow-up (no follow-up chains).
    """
    return bool(
        50 <= answer_score < 70
        and not previous_was_follow_up
        and missing_concepts
        and strengths
        and evaluation_source == "gemini"
    )


# -------------------------------------------------------------
# BLOCK 3: Combined decision for one evaluated response
# -------------------------------------------------------------
def adaptation_for(response):
    """Build the adaptation record shown to the candidate after each turn."""
    score = response["answer_quality_score"]
    difficulty = determine_next_difficulty(response["difficulty"], score)
    follow_up = should_generate_follow_up(
        score, response["is_follow_up"], response["missing_concepts"],
        response["strengths"], response.get("evaluation_source", "gemini"),
    )
    if follow_up:
        reason = "Probe a missing concept in an otherwise partially understood answer."
    elif score >= 85 and difficulty != response["difficulty"]:
        reason = "Strong technical coverage justified increasing difficulty."
    elif score < 50:
        reason = "Use a recovery concept question at the lowest permitted difficulty."
    else:
        reason = "Move to a new relevant topic at the selected difficulty."
    return {
        "previous_difficulty": response["difficulty"],
        "next_difficulty": difficulty,
        "is_follow_up": follow_up,
        "reason": reason,
    }
