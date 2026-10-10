"""Arena ranking: LeetCode-style ratings, overall and per category.

Every candidate starts at 1500 in each category and overall. A finished
ranked Arena changes the rating of its category and the overall rating:

    expected    = 1 / (1 + 10 ** ((difficulty_rating - rating) / 400))
    performance = session score / 100            (0 when the session is invalid)
    change      = K × (performance − expected) − penalties

The difficulty rating is the average of the levels played (easy 1200,
medium 1500, hard 1800, expert 2100), so a strong session at hard levels
earns more than the same score at easy ones. K is 40 for a candidate's
first five sessions in a category (ratings settle quickly), then 24.

Integrity penalties (subtracted from the change, so they always cost
points): 15 per proctoring violation, 50 when the session ended because the
candidate stayed away, and 100 when the session is invalid (someone else
answered). Rank is 1 + the number of candidates with a higher rating.
"""
import json
from typing import Optional

START_RATING = 1500
DIFFICULTY_RATING = {"easy": 1200, "medium": 1500, "hard": 1800, "expert": 2100}
K_NEW, K_SETTLED, NEW_GAMES = 40, 24, 5
PENALTY_PER_VIOLATION = 15
PENALTY_AWAY = 50
PENALTY_INVALID = 100
MIN_RATING = 100

CATEGORIES = {
    "software": "Software Engineering",
    "frontend": "Frontend / React",
    "backend": "Backend / Python",
    "java": "Java",
    "database": "SQL / Database",
    "dsa": "Data Structures & Algorithms",
    "general": "Custom topics",
}
OVERALL = "overall"
LABELS = {OVERALL: "Overall", **CATEGORIES}


# -------------------------------------------------------------
# BLOCK 1: Pure rules
# -------------------------------------------------------------
def expected_score(rating: int, difficulty_rating: float) -> float:
    return 1 / (1 + 10 ** ((difficulty_rating - rating) / 400))


def session_difficulty(difficulties: list[str]) -> float:
    values = [DIFFICULTY_RATING.get(d, 1500) for d in difficulties] or [1500]
    return sum(values) / len(values)


def penalties(violations: int, end_reason: Optional[str], verdict: Optional[str]) -> int:
    total = PENALTY_PER_VIOLATION * max(0, violations)
    if end_reason == "away":
        total += PENALTY_AWAY
    if verdict == "invalid":
        total += PENALTY_INVALID
    return total


def rating_change(rating: int, games: int, score: float, difficulty_rating: float, penalty: int = 0,
                  invalid: bool = False) -> int:
    k = K_NEW if games < NEW_GAMES else K_SETTLED
    performance = 0.0 if invalid else max(0.0, min(1.0, score / 100))
    change = round(k * (performance - expected_score(rating, difficulty_rating))) - penalty
    return max(change, MIN_RATING - rating)  # never below the floor


# -------------------------------------------------------------
# BLOCK 2: Storage
# -------------------------------------------------------------
def _rating(cur, user_id, category):
    cur.execute("SELECT rating, games, best_rating FROM user_ratings WHERE user_id = %s AND category = %s FOR UPDATE;",
                (str(user_id), category))
    return cur.fetchone() or {"rating": START_RATING, "games": 0, "best_rating": START_RATING}


def apply_session(cur, interview, *, score: float, difficulties: list[str], violations: int,
                  end_reason: Optional[str], verdict: Optional[str]) -> dict:
    """Update the category and overall ratings once per Arena session.

    Idempotent: a repeated call returns the stored changes.
    """
    interview_id = str(interview["id"])
    cur.execute("SELECT category, change, rating_after, details FROM rating_events WHERE interview_id = %s;",
                (interview_id,))
    existing = cur.fetchall()
    if existing:
        return summary(cur, interview["user_id"], existing)

    category = interview.get("arena_category") or "general"
    difficulty = session_difficulty(difficulties)
    penalty = penalties(violations, end_reason, verdict)
    rows = []
    for key in (category, OVERALL):
        current = _rating(cur, interview["user_id"], key)
        change = rating_change(current["rating"], current["games"], score, difficulty, penalty, verdict == "invalid")
        after = current["rating"] + change
        cur.execute(
            """INSERT INTO user_ratings (user_id, category, rating, games, best_rating, updated_at)
               VALUES (%s, %s, %s, 1, %s, NOW())
               ON CONFLICT (user_id, category) DO UPDATE SET
                 rating = EXCLUDED.rating, games = user_ratings.games + 1,
                 best_rating = GREATEST(user_ratings.best_rating, EXCLUDED.rating), updated_at = NOW();""",
            (str(interview["user_id"]), key, after, max(after, current["best_rating"])),
        )
        details = {"score": round(score, 1), "difficulty_rating": round(difficulty), "penalty": penalty,
                   "violations": violations, "end_reason": end_reason, "verdict": verdict,
                   "rating_before": current["rating"]}
        cur.execute(
            """INSERT INTO rating_events (user_id, interview_id, category, change, rating_after, details)
               VALUES (%s, %s, %s, %s, %s, %s);""",
            (str(interview["user_id"]), interview_id, key, change, after, json.dumps(details)),
        )
        rows.append({"category": key, "change": change, "rating_after": after, "details": details})
    return summary(cur, interview["user_id"], rows)


def rank(cur, user_id, category: str) -> dict:
    """Rank (1 = best) and number of ranked candidates in a category."""
    cur.execute("SELECT rating FROM user_ratings WHERE user_id = %s AND category = %s;", (str(user_id), category))
    mine = cur.fetchone()
    cur.execute("SELECT COUNT(*) AS total FROM user_ratings WHERE category = %s;", (category,))
    total = cur.fetchone()["total"]
    if not mine:
        return {"rank": None, "total": total, "rating": None}
    cur.execute("SELECT COUNT(*) AS higher FROM user_ratings WHERE category = %s AND rating > %s;",
                (category, mine["rating"]))
    return {"rank": cur.fetchone()["higher"] + 1, "total": total, "rating": mine["rating"]}


def summary(cur, user_id, rows) -> dict:
    result = {}
    for row in rows:
        details = row.get("details") or {}
        standing = rank(cur, user_id, row["category"])
        result[row["category"]] = {
            "label": LABELS.get(row["category"], row["category"]),
            "change": row["change"], "rating": row["rating_after"], "penalty": details.get("penalty", 0),
            "rank": standing["rank"], "total": standing["total"],
        }
    return result


def display_name(row) -> str:
    """Public name on the leaderboard: the profile name, never the email."""
    name = (row.get("full_name") or "").strip()
    return name[:40] if name else f"Candidate {str(row['user_id'])[:4].upper()}"


def leaderboard(cur, category: str, limit: int = 50) -> list[dict]:
    cur.execute(
        """SELECT r.user_id, r.rating, r.games, r.best_rating, u.full_name, u.firebase_uid,
                  RANK() OVER (ORDER BY r.rating DESC) AS rank
           FROM user_ratings r JOIN users u ON u.id = r.user_id
           WHERE r.category = %s ORDER BY r.rating DESC, r.games DESC LIMIT %s;""",
        (category, limit),
    )
    return cur.fetchall()
