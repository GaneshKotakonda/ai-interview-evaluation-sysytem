"""Coding round (bank, runner, grading) and Arena ranking rules."""
import inspect
import unittest
from unittest.mock import patch

import code_runner
import coding
import coding_bank
import ranking


def reference_program(problem):
    return ("import sys, heapq, bisect\n" + inspect.getsource(coding_bank._ints) + "\n"
            + inspect.getsource(problem.solve) + f"\nprint({problem.solve.__name__}(sys.stdin.read()))\n")


class BankTests(unittest.TestCase):
    def test_every_problem_is_complete_and_public_view_hides_tests(self):
        self.assertEqual(len({p.id for p in coding_bank.PROBLEMS}), len(coding_bank.PROBLEMS))
        for level in ("easy", "medium", "hard"):
            self.assertGreaterEqual(sum(p.difficulty == level for p in coding_bank.PROBLEMS), 4)
        for problem in coding_bank.PROBLEMS:
            with self.subTest(problem=problem.id):
                public = coding_bank.public(problem)
                self.assertGreaterEqual(public["hidden_tests"], 5)
                self.assertEqual(set(public["starter_code"]), {"python", "javascript", "cpp", "java"})
                self.assertNotIn("{hint}", public["starter_code"]["cpp"])
                self.assertFalse({"tests", "solve", "rubric", "edge_cases"} & set(public))
                self.assertNotIn(problem.rubric[0], str(public))
                self.assertEqual(coding_bank.tests(problem)[0]["input"], problem.examples[0])

    def test_tests_are_deterministic(self):
        problem = coding_bank.BY_ID["merge-intervals"]
        first = coding_bank.tests(problem)
        coding_bank._test_cache.clear()
        self.assertEqual(first, coding_bank.tests(problem))

    def test_pick_respects_difficulty_and_history(self):
        hard = {p.id for p in coding_bank.PROBLEMS if p.difficulty == "hard"}
        self.assertIn(coding_bank.pick("expert", set()).id, hard)
        self.assertIsNone(coding_bank.pick("hard", hard))


class RunnerTests(unittest.TestCase):
    def test_reference_passes_and_wrong_or_slow_code_fails(self):
        problem = coding_bank.BY_ID["two-sum"]
        tests = coding_bank.tests(problem)
        self.assertEqual(code_runner.run_tests("python", reference_program(problem), tests)["passed"], len(tests))
        wrong = code_runner.run_tests("python", "print('0 1')\n", tests[:2])
        self.assertEqual([r["status"] for r in wrong["results"]], ["passed", "wrong_answer"])
        slow = code_runner.run_tests("python", "while True:\n    pass\n", tests, time_limit=0.5)
        self.assertEqual(slow["results"][0]["status"], "time_limit")
        self.assertEqual(slow["results"][-1]["status"], "skipped")

    def test_child_process_sees_no_secrets(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "secret", "DATABASE_URL": "postgresql://secret"}):
            run = code_runner.run_tests("python", "import os\nprint(sorted(k for k in os.environ if 'SECRET' in os.environ[k].upper() or k in ('GEMINI_API_KEY','DATABASE_URL')))\n",
                                        [{"input": ""}])
        self.assertEqual(run["results"][0]["stdout"].strip(), "[]")

    def test_whitespace_insensitive_comparison(self):
        self.assertTrue(code_runner.outputs_match("1 2\n3  \n", "1 2 3"))
        self.assertFalse(code_runner.outputs_match("1 2", "1 2 3"))


class GradingTests(unittest.TestCase):
    public = coding_bank.public(coding_bank.BY_ID["two-sum"])

    def run_result(self, passed, total=10, compiled=True):
        statuses = ["passed"] * passed + ["wrong_answer"] * (total - passed)
        return {"compiled": compiled, "compile_output": "", "passed": passed, "total": total,
                "results": [{"status": s, "time_ms": 5} for s in statuses]}

    def test_tests_and_review_are_weighted_70_30(self):
        review = {"code_quality": 80, "efficiency": 60, "readability": 90, "complexity": "O(n)", "feedback": "ok",
                  "strengths": [], "improvements": [], "ai_likelihood": 20, "ai_signals": []}
        with patch.object(coding.gemini_service, "review_code", return_value=review):
            graded = coding.grade(self.public, "python", "print(1)", self.run_result(10), 2)
        self.assertEqual(graded["answer_quality_score"], round(0.7 * 100 + 0.3 * 70))
        self.assertEqual(graded["communication_score"], 90)
        self.assertEqual(graded["content_signals"]["scripted_likelihood"], 20)

    def test_no_passing_test_caps_and_untouched_scores_zero(self):
        with patch.object(coding.gemini_service, "review_code", return_value=None):
            failing = coding.grade(self.public, "python", "print(1)", self.run_result(0), 2)
            starter = coding.grade(self.public, "python", self.public["starter_code"]["python"], self.run_result(0), 2)
        self.assertLessEqual(failing["answer_quality_score"], coding.NO_TEST_PASSED_CAP)
        self.assertEqual(starter["answer_quality_score"], 0)
        self.assertEqual(starter["feedback"], "No solution was written.")

    def test_coding_turns_and_detection(self):
        self.assertEqual(coding.coding_turns(5), {2, 4})
        self.assertEqual(coding.coding_turns(6), {3, 5})
        self.assertEqual(coding.coding_turns(1), set())
        self.assertTrue(coding.suggests_coding("Backend Engineer"))
        self.assertFalse(coding.suggests_coding("HR Manager", "people operations"))


class RankingTests(unittest.TestCase):
    def test_expected_score_and_difficulty(self):
        self.assertAlmostEqual(ranking.expected_score(1500, 1500), 0.5)
        self.assertEqual(ranking.session_difficulty(["easy", "hard"]), 1500)

    def test_strong_hard_session_gains_more_than_strong_easy_one(self):
        hard = ranking.rating_change(1500, 0, 85, ranking.DIFFICULTY_RATING["hard"])
        easy = ranking.rating_change(1500, 0, 85, ranking.DIFFICULTY_RATING["easy"])
        self.assertGreater(hard, easy)
        self.assertLess(ranking.rating_change(1500, 0, 20, 1500), 0)

    def test_new_players_move_faster(self):
        self.assertGreater(ranking.rating_change(1500, 0, 100, 1500), ranking.rating_change(1500, 10, 100, 1500))

    def test_penalties_always_cost_points(self):
        self.assertEqual(ranking.penalties(2, "away", None), 2 * 15 + 50)
        self.assertEqual(ranking.penalties(0, None, "invalid"), 100)
        perfect = ranking.rating_change(1500, 0, 100, 1500)
        self.assertEqual(ranking.rating_change(1500, 0, 100, 1500, penalty=80), perfect - 80)
        self.assertLess(ranking.rating_change(1500, 0, 100, 1500, invalid=True), 0)
        self.assertEqual(ranking.rating_change(110, 0, 0, 2100, penalty=500), ranking.MIN_RATING - 110)

    def test_display_name_never_uses_email(self):
        self.assertEqual(ranking.display_name({"full_name": " Asha ", "user_id": "abcd-1"}), "Asha")
        self.assertEqual(ranking.display_name({"full_name": None, "user_id": "abcd-1"}), "Candidate ABCD")


if __name__ == "__main__":
    unittest.main()
