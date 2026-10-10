"""Coding round (VPL): which turns are coding, problem choice, grading.

When an interview has a coding round, some turns open the built-in VPL
instead of a spoken question (``coding_turns``): turns 2 and 4 of a
five-question interview, turns 3 and 5 of a six-level Arena (the Boss
Round stays a spoken/typed question).

Grading: 70% hidden and visible test cases, 30% an AI review of efficiency
and code quality. Code that passes no test scores at most 20; an empty or
untouched starter scores 0. Without an AI review the tests decide alone.
"""
from typing import Optional

import coding_ai
import coding_bank
import config
import gemini_service

TEST_WEIGHT = 0.7
REVIEW_WEIGHT = 0.3
NO_TEST_PASSED_CAP = 20

# Words in a role, topic or job description that suggest a coding round.
CODING_KEYWORDS = (
    "software", "developer", "engineer", "programm", "coding", "algorithm", "data structure", "dsa",
    "python", "java", "javascript", "typescript", "c++", "backend", "back-end", "full stack", "fullstack",
    "frontend", "front-end", "react", "node", "leetcode",
)


def suggests_coding(*texts: Optional[str]) -> bool:
    text = " ".join(t for t in texts if t).casefold()
    return any(keyword in text for keyword in CODING_KEYWORDS)


def coding_turns(max_turns: int) -> set[int]:
    if max_turns >= 6:
        return {3, 5}
    if max_turns >= 4:
        return {2, 4}
    return {2} if max_turns >= 2 else set()


# -------------------------------------------------------------
# Choosing a problem
# -------------------------------------------------------------
def used_problem_ids(cur, user_id) -> set[str]:
    """Problems this candidate has already been given (any interview)."""
    cur.execute(
        """SELECT q.coding->>'problem_id' AS problem_id FROM interview_questions q
           JOIN interviews i ON i.id = q.interview_id
           WHERE i.user_id = %s AND q.kind = 'coding';""",
        (str(user_id),),
    )
    return {row["problem_id"] for row in cur.fetchall() if row.get("problem_id")}


def question_content(cur, interview, difficulty: str) -> dict:
    """Question content (as store_question expects) for a coding turn."""
    used = used_problem_ids(cur, interview["user_id"])
    problem = coding_bank.pick(difficulty, used)
    record = None
    if problem is None:
        record = coding_ai.generate(interview["role_title"], difficulty,
                                    [p.title for p in coding_bank.PROBLEMS])
    if problem is None and record is None:
        # Every bank problem was seen and no AI problem passed validation:
        # reuse one that is not in this interview.
        cur.execute("SELECT coding->>'problem_id' AS problem_id FROM interview_questions "
                    "WHERE interview_id = %s AND kind = 'coding';", (str(interview["id"]),))
        here = {row["problem_id"] for row in cur.fetchall()}
        problem = coding_bank.pick(difficulty, here) or coding_bank.pick(difficulty, set())

    if record is None:
        public = coding_bank.public(problem)
        private = {"source": "bank", "problem_id": problem.id}
        rubric, complexity = problem.rubric, problem.complexity
    else:
        public, rubric, complexity = record["public"], record["rubric"], record["complexity"]
        private = {"source": "ai", "problem_id": public["problem_id"], "tests": record["tests"]}
    public["complexity"] = complexity
    public["minutes"] = config.CODING_MINUTES_PER_PROBLEM
    return {
        "kind": "coding",
        "question": (f"Coding problem: {public['title']}. {public['statement']} "
                     "Write your solution in the code editor, run the examples, then submit."),
        "difficulty": difficulty,
        "is_follow_up": False,
        "topic": "Coding: " + (public["tags"][0] if public.get("tags") else "problem solving"),
        "adaptive_reason": "Coding round: implement and test a solution in the VPL.",
        "rubric_points": rubric,
        "coding": public,
        "coding_private": private,
    }


def tests_for(private: dict) -> list[dict]:
    if private.get("source") == "bank":
        return coding_bank.tests(coding_bank.BY_ID[private["problem_id"]])
    return list(private.get("tests") or [])


def examples_for(public: dict) -> list[dict]:
    return [{"input": e["input"], "expected": e["expected"]} for e in public.get("examples") or []]


def custom_expected(private: dict, text: str) -> Optional[str]:
    """Expected output for the candidate's own input (bank problems only)."""
    if private.get("source") != "bank":
        return None
    try:
        return coding_bank.BY_ID[private["problem_id"]].solve(text)
    except Exception:
        return None  # not a valid input for this problem


# -------------------------------------------------------------
# Grading a submission
# -------------------------------------------------------------
def is_untouched(public: dict, language: str, code: str) -> bool:
    starter = (public.get("starter_code") or {}).get(language, "")
    return not code.strip() or code.split() == starter.split()


def grade(public: dict, language: str, code: str, run: Optional[dict], examples: int) -> dict:
    """Scores and the stored coding result for one submission.

    ``run`` is code_runner's result over all tests (examples first).
    """
    untouched = is_untouched(public, language, code)
    run = run or {"compiled": False, "compile_output": "", "results": [], "passed": 0, "total": 0}
    statuses = [r["status"] for r in run["results"]]
    total = run["total"] or 1
    tests_score = 0 if untouched else round(100 * run["passed"] / total)
    summary = {
        "passed": run["passed"], "total": run["total"], "compiled": run["compiled"],
        "examples_passed": statuses[:examples].count("passed"),
        "hidden_passed": statuses[examples:].count("passed"),
        "failures": {s: statuses.count(s) for s in set(statuses) if s != "passed"},
    }
    review = None if untouched else gemini_service.review_code(public, language, code, summary)
    if review:
        review_score = round((review["code_quality"] + review["efficiency"]) / 2)
        quality = round(TEST_WEIGHT * tests_score + REVIEW_WEIGHT * review_score)
        feedback = review["feedback"] or f"{run['passed']} of {run['total']} tests passed."
        communication = review["readability"]
    else:
        review_score, quality, communication = None, tests_score, tests_score
        feedback = (f"{run['passed']} of {run['total']} tests passed."
                    + ("" if run["compiled"] else " The code did not compile."))
    if run["passed"] == 0:
        quality = min(quality, NO_TEST_PASSED_CAP)
    if untouched:
        quality = communication = 0
        feedback = "No solution was written."

    result = {**summary, "language": language, "tests_score": tests_score, "review_score": review_score,
              "statuses": statuses, "compile_output": (run.get("compile_output") or "")[-2000:],
              "complexity": (review or {}).get("complexity"),
              "max_time_ms": max((r["time_ms"] for r in run["results"]), default=0)}
    return {
        "answer_quality_score": quality,
        "communication_score": communication,
        "criteria_scores": None,
        "strengths": (review or {}).get("strengths", []),
        "improvements": (review or {}).get("improvements", []) or (
            [] if run["passed"] == run["total"] else ["Handle every case in the hidden tests (edge cases and large inputs)."]),
        "missing_concepts": [],
        "feedback": feedback,
        "evaluation_source": "tests+review" if review else "tests",
        "content_signals": ({"scripted_likelihood": review["ai_likelihood"], "scripted_signals": review["ai_signals"]}
                            if review else None),
        "coding_result": result,
    }


def warm_up() -> None:
    """Compute the bank's expected outputs ahead of the first coding question."""
    for problem in coding_bank.PROBLEMS:
        coding_bank.tests(problem)
