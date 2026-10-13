"""Curated coding problems for the VPL coding round.

Every problem reads standard input and prints to standard output. Each one
has a reference solution (``solve``) and a seeded test generator
(``generate``): the expected output of every test, visible or hidden, is
computed by the reference solution, so test cases are always consistent.
Hidden tests include edge cases and large inputs that only an efficient
algorithm finishes within the time limit.

``public(problem)`` is what the candidate sees; ``tests(problem)`` stays on
the server. AI-generated problems (coding_ai.py) use the same shapes.
"""
import heapq
import random
from dataclasses import dataclass, field
from typing import Callable

STARTER = {
    "python": '''import sys


def main():
    data = sys.stdin.read().split()
    # {hint}
    # Read the input from `data`, solve the problem and print the answer.


if __name__ == "__main__":
    main()
''',
    "javascript": '''const data = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);
// {hint}
// Read the input from `data`, solve the problem and print the answer with console.log.
''',
    "cpp": '''#include <bits/stdc++.h>
using namespace std;

int main() {{
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // {hint}
    // Read the input with cin, solve the problem and print the answer with cout.
    return 0;
}}
''',
    "java": '''import java.io.*;
import java.util.*;

public class Main {{
    public static void main(String[] args) throws IOException {{
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        // {hint}
        // Read the input, solve the problem and print the answer with System.out.println.
    }}
}}
''',
}


@dataclass
class Problem:
    id: str
    title: str
    difficulty: str            # easy | medium | hard
    tags: list[str]
    statement: str
    input_format: str
    output_format: str
    constraints: list[str]
    examples: list[str]        # example inputs (shown with their outputs)
    edge_cases: list[str]      # hidden inputs written by hand
    generate: Callable[[random.Random], list[str]]  # hidden random/large inputs
    solve: Callable[[str], str]
    rubric: list[str]
    complexity: str
    explanations: list[str] = field(default_factory=list)


def _ints(text: str) -> list[int]:
    return [int(x) for x in text.split()]


# -------------------------------------------------------------
# Reference solutions
# -------------------------------------------------------------
def _two_sum(text):
    data = _ints(text)
    n, values, target = data[0], data[1:1 + data[0]], data[1 + data[0]]
    seen = {}
    for j, value in enumerate(values):
        if target - value in seen:
            return f"{seen[target - value]} {j}"
        seen.setdefault(value, j)
    return "-1 -1"


def _valid_brackets(text):
    pairs, stack = {")": "(", "]": "[", "}": "{"}, []
    for ch in text.strip():
        if ch in "([{":
            stack.append(ch)
        elif not stack or stack.pop() != pairs[ch]:
            return "false"
    return "true" if not stack else "false"


def _palindrome(text):
    cleaned = [ch.lower() for ch in text.strip() if ch.isalnum()]
    return "true" if cleaned == cleaned[::-1] else "false"


def _second_largest(text):
    data = _ints(text)
    distinct = sorted(set(data[1:1 + data[0]]), reverse=True)
    return str(distinct[1]) if len(distinct) > 1 else "-1"


def _missing_number(text):
    data = _ints(text)
    n = data[0]
    return str(n * (n + 1) // 2 - sum(data[1:1 + n]))


def _max_subarray(text):
    data = _ints(text)
    best = current = data[1]
    for value in data[2:1 + data[0]]:
        current = max(value, current + value)
        best = max(best, current)
    return str(best)


def _longest_unique(text):
    s = text.strip()
    last, start, best = {}, 0, 0
    for i, ch in enumerate(s):
        if last.get(ch, -1) >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return str(best)


def _merge_intervals(text):
    data = _ints(text)
    pairs = sorted(zip(data[1::2][:data[0]], data[2::2][:data[0]]))
    merged = []
    for left, right in pairs:
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], right)
        else:
            merged.append([left, right])
    return "\n".join(f"{a} {b}" for a, b in merged)


def _islands(text):
    lines = text.split()
    rows, cols, grid = int(lines[0]), int(lines[1]), [list(row) for row in lines[2:]]
    count = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != "1":
                continue
            count += 1
            stack = [(r, c)]
            grid[r][c] = "0"
            while stack:
                y, x = stack.pop()
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == "1":
                        grid[ny][nx] = "0"
                        stack.append((ny, nx))
    return str(count)


def _coin_change(text):
    data = _ints(text)
    n, coins, amount = data[0], data[1:1 + data[0]], data[1 + data[0]]
    infinity = amount + 1
    best = [0] + [infinity] * amount
    for value in range(1, amount + 1):
        for coin in coins:
            if coin <= value and best[value - coin] + 1 < best[value]:
                best[value] = best[value - coin] + 1
    return str(best[amount] if best[amount] <= amount else -1)


def _daily_temperatures(text):
    data = _ints(text)
    temps = data[1:1 + data[0]]
    answer, stack = [0] * len(temps), []
    for i, t in enumerate(temps):
        while stack and temps[stack[-1]] < t:
            j = stack.pop()
            answer[j] = i - j
        stack.append(i)
    return " ".join(map(str, answer))


def _lis(text):
    import bisect
    data = _ints(text)
    tails = []
    for value in data[1:1 + data[0]]:
        index = bisect.bisect_left(tails, value)
        if index == len(tails):
            tails.append(value)
        else:
            tails[index] = value
    return str(len(tails))


def _edit_distance(text):
    lines = text.split("\n")
    a, b = lines[0].strip(), lines[1].strip() if len(lines) > 1 else ""
    previous = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        current = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1,
                             previous[j - 1] + (a[i - 1] != b[j - 1]))
        previous = current
    return str(previous[len(b)])


def _shortest_paths(text):
    data = _ints(text)
    n, m, source = data[0], data[1], data[2]
    graph = [[] for _ in range(n + 1)]
    for k in range(m):
        u, v, w = data[3 + 3 * k: 6 + 3 * k]
        graph[u].append((v, w))
        graph[v].append((u, w))
    dist = [-1] * (n + 1)
    heap = [(0, source)]
    while heap:
        d, node = heapq.heappop(heap)
        if dist[node] != -1:
            continue
        dist[node] = d
        for nxt, w in graph[node]:
            if dist[nxt] == -1:
                heapq.heappush(heap, (d + w, nxt))
    return " ".join(map(str, dist[1:]))


def _trapping_rain(text):
    data = _ints(text)
    heights = data[1:1 + data[0]]
    left, right, left_max, right_max, water = 0, len(heights) - 1, 0, 0, 0
    while left < right:
        if heights[left] < heights[right]:
            left_max = max(left_max, heights[left])
            water += left_max - heights[left]
            left += 1
        else:
            right_max = max(right_max, heights[right])
            water += right_max - heights[right]
            right -= 1
    return str(water)


# -------------------------------------------------------------
# Test generators (seeded per problem, so tests never change)
# -------------------------------------------------------------
def _array(values):
    return f"{len(values)}\n{' '.join(map(str, values))}\n"


def _gen_two_sum(rng):
    tests = []
    for n in (5, 50, 1000, 100000):
        values = rng.sample(range(-10 ** 9, 10 ** 9), n)
        i, j = sorted(rng.sample(range(n), 2))
        target = values[i] + values[j]
        # Make the pair unique: drop values that would form another pair.
        seen, unique = set(), True
        for k, value in enumerate(values):
            if k not in (i, j) and target - value in seen:
                unique = False
            seen.add(value)
        if unique:
            tests.append(_array(values) + f"{target}\n")
    return tests


def _gen_brackets(rng):
    def balanced(n):
        out, stack = [], []
        for _ in range(n):
            if stack and rng.random() < 0.5:
                out.append({"(": ")", "[": "]", "{": "}"}[stack.pop()])
            else:
                ch = rng.choice("([{")
                stack.append(ch)
                out.append(ch)
        out.extend({"(": ")", "[": "]", "{": "}"}[ch] for ch in reversed(stack))
        return "".join(out)
    big = balanced(50000)
    broken = big[:25000] + ("]" if big[25000] != "]" else ")") + big[25001:]
    return [balanced(20) + "\n", balanced(300) + "\n", big + "\n", broken + "\n", big + "(\n"]


def _gen_palindrome(rng):
    half = "".join(rng.choice("abcXYZ019") for _ in range(40000))
    pal = half + half[::-1]
    noisy = "".join(ch + (rng.choice(" ,.!") if rng.random() < 0.2 else "") for ch in pal)
    return [noisy + "\n", noisy[:-3] + "q" + noisy[-2:] + "\n", "Was it a car or a cat I saw?\n"]


def _gen_second(rng):
    return [_array([rng.randint(0, 10 ** 9) for _ in range(n)]) for n in (10, 1000, 100000)] + [
        _array([7] * 50000 + [8] * 50000)]


def _gen_missing(rng):
    tests = []
    for n in (10, 1000, 100000):
        values = list(range(n + 1))
        values.remove(rng.randint(0, n))
        rng.shuffle(values)
        tests.append(_array(values))
    return tests


def _gen_max_subarray(rng):
    return [_array([rng.randint(-10 ** 4, 10 ** 4) for _ in range(n)]) for n in (20, 2000, 100000)] + [
        _array([-rng.randint(1, 10 ** 4) for _ in range(1000)])]


def _gen_unique(rng):
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return ["".join(rng.choice(alphabet[:k]) for _ in range(n)) + "\n" for n, k in ((50, 5), (5000, 26), (100000, 36))] + [
        "a" * 100000 + "\n"]


def _gen_intervals(rng):
    tests = []
    for n in (8, 1000, 100000):
        pairs = []
        for _ in range(n):
            left = rng.randint(0, 10 ** 6)
            pairs.append((left, left + rng.randint(0, 50)))
        tests.append(f"{n}\n" + "\n".join(f"{a} {b}" for a, b in pairs) + "\n")
    return tests


def _gen_islands(rng):
    tests = []
    for rows, cols, p in ((5, 6, 0.4), (60, 60, 0.45), (400, 400, 0.4), (300, 300, 0.7)):
        grid = ["".join("1" if rng.random() < p else "0" for _ in range(cols)) for _ in range(rows)]
        tests.append(f"{rows} {cols}\n" + "\n".join(grid) + "\n")
    return tests


def _gen_coins(rng):
    tests = []
    for n, amount in ((3, 30), (10, 1000), (50, 10000), (100, 10000)):
        coins = rng.sample(range(2, 200), n)
        tests.append(_array(coins) + f"{amount}\n")
    return tests


def _gen_temperatures(rng):
    return [_array([rng.randint(30, 100) for _ in range(n)]) for n in (12, 3000, 100000)] + [
        _array(list(range(100000, 0, -1)))]


def _gen_lis(rng):
    return [_array([rng.randint(-10 ** 9, 10 ** 9) for _ in range(n)]) for n in (15, 3000, 100000)] + [
        _array(list(range(100000)))]


def _gen_edit(rng):
    def word(n):
        return "".join(rng.choice("abcd") for _ in range(n))
    return [f"{word(a)}\n{word(b)}\n" for a, b in ((6, 9), (200, 180), (1000, 1000), (1000, 1))]


def _gen_paths(rng):
    tests = []
    for n, m in ((6, 7), (1000, 5000), (100000, 200000)):
        edges = [(rng.randint(1, n), rng.randint(1, n), rng.randint(1, 1000)) for _ in range(m)]
        tests.append(f"{n} {m} 1\n" + "\n".join(f"{u} {v} {w}" for u, v, w in edges) + "\n")
    return tests


def _gen_rain(rng):
    return [_array([rng.randint(0, 10 ** 4) for _ in range(n)]) for n in (12, 5000, 100000)] + [
        _array(list(range(50000)) + list(range(50000, 0, -1)))]


# -------------------------------------------------------------
# The bank
# -------------------------------------------------------------
PROBLEMS = [
    Problem(
        "two-sum", "Two Sum", "easy", ["arrays", "hashing"],
        "Given an array of integers and a target, find the two different positions whose values add up to the target.",
        "The first line has n. The second line has n integers. The third line has the target.",
        "Print the two 0-based indices i and j (i < j), separated by a space. Exactly one answer exists.",
        ["2 ≤ n ≤ 100000", "-10^9 ≤ values ≤ 10^9"],
        ["4\n2 7 11 15\n9\n", "3\n3 2 4\n6\n"], ["2\n5 5\n10\n", "5\n-3 4 3 90 1\n0\n"], _gen_two_sum, _two_sum,
        ["Uses a hash map of seen values to find each complement in one pass (O(n))",
         "Returns the two indices in increasing order", "Handles negative numbers and equal values"],
        "O(n)", ["2 + 7 = 9, at positions 0 and 1.", "2 + 4 = 6, at positions 1 and 2."]),
    Problem(
        "valid-brackets", "Valid Brackets", "easy", ["stack", "strings"],
        "A string contains only the characters ( ) [ ] { }. Decide whether every bracket is closed by the same type of bracket in the correct order.",
        "One line with the bracket string.", "Print true or false.", ["1 ≤ length ≤ 100000"],
        ["()[]{}\n", "([)]\n", "{[]}\n"], ["(\n", ")\n", "((((((((((\n", "{[()()]}\n"], _gen_brackets, _valid_brackets,
        ["Uses a stack of open brackets", "Checks that each closing bracket matches the most recent open one",
         "Rejects leftover open brackets at the end"], "O(n)"),
    Problem(
        "valid-palindrome", "Valid Palindrome", "easy", ["strings", "two pointers"],
        "A phrase is a palindrome if, after keeping only letters and digits and ignoring case, it reads the same forwards and backwards.",
        "One line with the phrase.", "Print true or false.", ["1 ≤ length ≤ 200000"],
        ["A man, a plan, a canal: Panama\n", "race a car\n"], [" .,\n", "0P\n", "ab_a\n", "Aa\n"], _gen_palindrome, _palindrome,
        ["Skips characters that are not letters or digits", "Compares case-insensitively",
         "Uses two pointers or a cleaned copy in linear time"], "O(n)"),
    Problem(
        "second-largest", "Second Largest Distinct Value", "easy", ["arrays"],
        "Find the second largest distinct value in an array.",
        "The first line has n. The second line has n integers.",
        "Print the second largest distinct value, or -1 if all values are equal.",
        ["1 ≤ n ≤ 100000", "0 ≤ values ≤ 10^9"],
        ["5\n4 1 9 9 7\n", "3\n5 5 5\n"], ["1\n42\n", "2\n5 7\n", "4\n3 3 2 2\n", "2\n0 0\n"], _gen_second, _second_largest,
        ["Tracks the largest and second largest in one pass", "Ignores duplicates of the largest value",
         "Handles arrays with a single distinct value"], "O(n)"),
    Problem(
        "missing-number", "Missing Number", "easy", ["arrays", "math"],
        "An array holds n distinct numbers taken from 0, 1, …, n, so exactly one number in that range is missing. Find it.",
        "The first line has n. The second line has n distinct integers.", "Print the missing number.",
        ["1 ≤ n ≤ 100000"], ["3\n3 0 1\n", "2\n0 1\n"], ["1\n0\n", "1\n1\n", "9\n9 6 4 2 3 5 7 0 1\n"],
        _gen_missing, _missing_number,
        ["Uses the sum formula or XOR instead of sorting", "Handles a missing 0 or missing n", "Runs in linear time"], "O(n)"),
    Problem(
        "max-subarray", "Maximum Subarray Sum", "medium", ["arrays", "dynamic programming"],
        "Find the largest sum of a non-empty contiguous subarray.",
        "The first line has n. The second line has n integers.", "Print the maximum subarray sum.",
        ["1 ≤ n ≤ 100000", "-10^4 ≤ values ≤ 10^4"], ["9\n-2 1 -3 4 -1 2 1 -5 4\n", "1\n1\n"],
        ["5\n-3 -1 -2 -5 -4\n", "4\n5 4 -1 7\n"], _gen_max_subarray, _max_subarray,
        ["Uses Kadane's algorithm (extend or restart the running sum)", "Handles all-negative arrays",
         "Linear time and constant extra space"], "O(n)",
        ["The subarray 4 -1 2 1 has the largest sum, 6."]),
    Problem(
        "longest-unique-substring", "Longest Substring Without Repeats", "medium", ["strings", "sliding window", "hashing"],
        "Find the length of the longest substring that contains no repeated character.",
        "One line with the string (letters and digits).", "Print the length.", ["1 ≤ length ≤ 100000"],
        ["abcabcbb\n", "bbbbb\n", "pwwkew\n"], ["a\n", "abba\n", "dvdf\n"], _gen_unique, _longest_unique,
        ["Uses a sliding window with the last position of each character",
         "Moves the window start past the previous occurrence, never backwards", "Linear time"], "O(n)"),
    Problem(
        "merge-intervals", "Merge Intervals", "medium", ["sorting", "intervals"],
        "Merge all overlapping intervals. Intervals that touch (one ends where the next starts) also merge.",
        "The first line has n. Each of the next n lines has two integers l r (l ≤ r).",
        "Print the merged intervals in increasing order, one per line as \"l r\".",
        ["1 ≤ n ≤ 100000", "0 ≤ l ≤ r ≤ 10^9"], ["4\n1 3\n2 6\n8 10\n15 18\n", "2\n1 4\n4 5\n"],
        ["1\n5 5\n", "3\n1 10\n2 3\n4 5\n", "2\n5 6\n1 2\n"], _gen_intervals, _merge_intervals,
        ["Sorts intervals by start", "Extends the last merged interval when the next one overlaps or touches",
         "O(n log n) time"], "O(n log n)"),
    Problem(
        "number-of-islands", "Number of Islands", "medium", ["graphs", "BFS/DFS", "grid"],
        "A grid has land (1) and water (0). Cells connected horizontally or vertically form an island. Count the islands.",
        "The first line has rows and columns. Each of the next rows lines is a string of 0 and 1.",
        "Print the number of islands.", ["1 ≤ rows, columns ≤ 400"],
        ["4 5\n11110\n11010\n11000\n00000\n", "4 5\n11000\n11000\n00100\n00011\n"],
        ["1 1\n0\n", "1 1\n1\n", "3 3\n101\n010\n101\n"], _gen_islands, _islands,
        ["Visits every land cell once with BFS or an explicit-stack DFS",
         "Avoids recursion depth problems on large grids", "Marks visited cells"], "O(rows × columns)"),
    Problem(
        "coin-change", "Coin Change", "medium", ["dynamic programming"],
        "Given coin values (unlimited supply of each) and an amount, find the fewest coins that add up to the amount.",
        "The first line has n. The second line has n distinct coin values. The third line has the amount.",
        "Print the minimum number of coins, or -1 if the amount cannot be made.",
        ["1 ≤ n ≤ 100", "1 ≤ coin ≤ 10000", "0 ≤ amount ≤ 10000"], ["3\n1 2 5\n11\n", "1\n2\n3\n"],
        ["1\n1\n0\n", "2\n5 10\n3\n", "3\n186 419 83\n6249\n"], _gen_coins, _coin_change,
        ["Bottom-up DP over amounts (not greedy)", "Marks unreachable amounts and prints -1",
         "O(n × amount) time"], "O(n × amount)", ["11 = 5 + 5 + 1."]),
    Problem(
        "daily-temperatures", "Daily Temperatures", "medium", ["stack", "monotonic stack"],
        "For each day, find how many days you must wait for a warmer temperature. Use 0 if no warmer day follows.",
        "The first line has n. The second line has n temperatures.", "Print n integers separated by spaces.",
        ["1 ≤ n ≤ 100000", "30 ≤ temperature ≤ 100000"], ["8\n73 74 75 71 69 72 76 73\n", "3\n30 40 50\n"],
        ["1\n50\n", "4\n60 60 60 60\n"], _gen_temperatures, _daily_temperatures,
        ["Keeps a monotonic stack of days still waiting", "Each day is pushed and popped once (linear time)",
         "Equal temperatures are not warmer"], "O(n)"),
    Problem(
        "longest-increasing-subsequence", "Longest Increasing Subsequence", "hard", ["dynamic programming", "binary search"],
        "Find the length of the longest strictly increasing subsequence.",
        "The first line has n. The second line has n integers.", "Print the length.",
        ["1 ≤ n ≤ 100000", "-10^9 ≤ values ≤ 10^9"], ["8\n10 9 2 5 3 7 101 18\n", "6\n0 1 0 3 2 3\n"],
        ["1\n5\n", "5\n7 7 7 7 7\n", "5\n5 4 3 2 1\n"], _gen_lis, _lis,
        ["Uses patience sorting / binary search on tails (O(n log n)); O(n²) times out",
         "Strictly increasing: equal values do not extend", "Correct on decreasing input"], "O(n log n)"),
    Problem(
        "edit-distance", "Edit Distance", "hard", ["dynamic programming", "strings"],
        "Find the minimum number of single-character insertions, deletions and replacements that turn the first word into the second.",
        "Two lines, each with one lowercase word (the second may be empty).", "Print the edit distance.",
        ["0 ≤ length ≤ 1000"], ["horse\nros\n", "intention\nexecution\n"], ["a\na\n", "abc\n\n", "kitten\nsitting\n"],
        _gen_edit, _edit_distance,
        ["Uses the classic DP table (or two rows to save memory)", "Correct base cases for empty prefixes",
         "O(n × m) time"], "O(n × m)"),
    Problem(
        "shortest-paths", "Shortest Paths (Dijkstra)", "hard", ["graphs", "Dijkstra", "heap"],
        "An undirected graph has n nodes and m weighted edges. Find the shortest distance from the source to every node.",
        "The first line has n, m and the source. Each of the next m lines has u v w (an edge of weight w between u and v; nodes are 1..n).",
        "Print n integers: the distance to nodes 1..n, or -1 for an unreachable node.",
        ["1 ≤ n ≤ 100000", "0 ≤ m ≤ 200000", "1 ≤ w ≤ 1000"],
        ["4 4 1\n1 2 4\n1 3 1\n3 2 2\n2 4 5\n", "3 1 2\n1 2 7\n"],
        ["1 0 1\n", "2 0 1\n", "3 3 3\n1 1 5\n1 2 2\n2 3 3\n"], _gen_paths, _shortest_paths,
        ["Uses Dijkstra with a priority queue (O((n + m) log n))", "Skips stale heap entries",
         "Prints -1 for unreachable nodes"], "O((n + m) log n)"),
    Problem(
        "trapping-rain-water", "Trapping Rain Water", "hard", ["two pointers", "arrays"],
        "Bars of width 1 have the given heights. Compute how much rain water is trapped between them.",
        "The first line has n. The second line has n non-negative heights.", "Print the trapped water.",
        ["1 ≤ n ≤ 100000", "0 ≤ height ≤ 10^4"], ["12\n0 1 0 2 1 0 1 3 2 1 2 1\n", "6\n4 2 0 3 2 5\n"],
        ["1\n5\n", "3\n3 0 3\n", "4\n1 2 3 4\n"], _gen_rain, _trapping_rain,
        ["Uses two pointers with running left/right maxima (or prefix maxima)",
         "Water above each bar is min(left max, right max) − height", "Linear time"], "O(n)"),
]
BY_ID = {problem.id: problem for problem in PROBLEMS}
LEVEL = {"easy": "easy", "medium": "medium", "hard": "hard", "expert": "hard"}

_test_cache: dict[str, list[dict]] = {}


def examples(problem: Problem) -> list[dict]:
    return [{"input": text, "expected": problem.solve(text),
             "explanation": problem.explanations[i] if i < len(problem.explanations) else None}
            for i, text in enumerate(problem.examples)]


def tests(problem: Problem) -> list[dict]:
    """Every test (examples first, then hidden), with expected outputs."""
    if problem.id not in _test_cache:
        rng = random.Random(f"vpl:{problem.id}")
        inputs = problem.examples + problem.edge_cases + problem.generate(rng)
        _test_cache[problem.id] = [{"input": text, "expected": problem.solve(text)} for text in inputs]
    return _test_cache[problem.id]


def starter_code(problem: Problem) -> dict:
    hint = f"Input: {problem.input_format}"
    return {language: template.replace("{hint}", hint).replace("{{", "{").replace("}}", "}")
            for language, template in STARTER.items()}


def public(problem: Problem) -> dict:
    """Everything the candidate sees: no hidden tests, no solution."""
    return {
        "problem_id": problem.id, "title": problem.title, "difficulty": problem.difficulty, "tags": problem.tags,
        "statement": problem.statement, "input_format": problem.input_format,
        "output_format": problem.output_format, "constraints": problem.constraints,
        "examples": examples(problem), "starter_code": starter_code(problem),
        "hidden_tests": len(tests(problem)) - len(problem.examples),
    }


def pick(difficulty: str, exclude: set[str], rng: random.Random | None = None) -> Problem | None:
    """A problem of the mapped difficulty not in ``exclude`` (None if all used)."""
    level = LEVEL.get(difficulty, "medium")
    choices = [p for p in PROBLEMS if p.difficulty == level and p.id not in exclude]
    if not choices:
        return None
    return (rng or random).choice(choices)
