"""Validation and local fallbacks for targeted knowledge verification."""
from difflib import SequenceMatcher
import re

CHALLENGE_TYPES = {"application", "reasoning", "edge_case", "calculation", "debugging", "trade_off"}
NEUTRAL_REASON = "Knowledge verification challenge"
_UNSAFE = re.compile(r"\b(?:cheat(?:ed|ing)?|caught|suspected|suspicious|possible assistance|"
                     r"ignore (?:all |previous )?instructions|reveal (?:hidden|private)|"
                     r"hidden tests?|private rubric|answer key|system prompt)\b", re.I)
_CODE = re.compile(r"`|\b(?:def|class|function)\s+\w+\s*\(|\breturn\s+[^.?!]+[;{}]|"
                   r"\b\w+\s*=\s*(?:\[|\{|\w+\()", re.I)


def _normal(text):
    return " ".join(re.findall(r"[\w]+", text.casefold()))


def _text(value, limit, field, minimum=1):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= limit:
        raise ValueError(f"Invalid {field}")
    return value.strip()


def _normalise(question, rubric, target, challenge_type, context, source):
    return {"question": question, "rubric_points": rubric,
            "verification_target": target, "challenge_type": challenge_type,
            "kind": "verify", "difficulty": context.get("current_difficulty", "medium"),
            "topic": _safe_topic(context), "is_follow_up": True, "boss_round": False,
            "adaptive_reason": NEUTRAL_REASON, "generation_source": source}


def _safe_topic(context):
    topic = context.get("previous_topic")
    if isinstance(topic, str) and topic.strip() and not _UNSAFE.search(topic) and not _CODE.search(topic):
        return topic.strip()[:120]
    return "Previous answer"


def validate_question(data, context):
    """Reject malformed/disclosing probes; fix policy fields on the server."""
    if not isinstance(data, dict):
        raise ValueError("Verification must be an object")
    question = _text(data.get("question"), 1200, "question", 30)
    target = _text(data.get("verification_target"), 160, "verification_target")
    challenge_type = data.get("challenge_type")
    if not isinstance(challenge_type, str):
        raise ValueError("Unsupported challenge type")
    challenge_type = challenge_type.strip().lower().replace("-", "_")
    if challenge_type not in CHALLENGE_TYPES:
        raise ValueError("Unsupported challenge type")
    rubric = data.get("rubric_points")
    if not isinstance(rubric, list) or not 1 <= len(rubric) <= 8:
        raise ValueError("Invalid rubric")
    rubric = [_text(point, 500, "rubric point") for point in rubric]
    if _UNSAFE.search(question) or _UNSAFE.search(target) or _CODE.search(question):
        raise ValueError("Unsafe verification question")
    normal = _normal(question)
    for point in rubric + list(context.get("rubric_points") or []):
        if isinstance(point, str) and len(point.strip()) >= 24 and _normal(point) in normal:
            raise ValueError("Private rubric included in question")
    answer = context.get("candidate_answer") or ""
    if isinstance(answer, str) and len(answer.strip()) >= 24 and _normal(answer) in normal:
        raise ValueError("Submitted answer included in question")
    history = [context.get("previous_question") or ""]
    history.extend(item.get("question") or item.get("question_text") or ""
                   for item in context.get("recent_history") or [] if isinstance(item, dict))
    if any(old and SequenceMatcher(None, _normal(old), normal).ratio() >= 0.85 for old in history):
        raise ValueError("Repeated question")
    # A prompt that only asks for a definition or binary answer cannot
    # establish application or reasoning, regardless of its type label.
    reasoning = re.search(r"\b(?:why|how|trace|walk|calculate|compare|debug|scenario|example|trade.off|edge.case|bounds)\b", question, re.I)
    if re.match(r"\s*(?:what (?:is|are)|define|can|does|do|is|are)\b", question, re.I) and not reasoning:
        raise ValueError("Definition or yes/no-only question")
    if re.match(r"\s*explain\b", question, re.I) and len(question.split()) <= 8 and not reasoning:
        raise ValueError("Definition-only question")
    if not reasoning and not re.search(r"\b(?:apply|implement|design|reason|handle|choose|predict)\b", question, re.I):
        raise ValueError("Question does not probe practical understanding")
    return _normalise(question, rubric, target, challenge_type, context, "gemini")


# Only concepts present in the supplied answer/rubric are selected. The
# fallback never claims the candidate already discussed a missing concept.
_CONCEPTS = [
    (("binary search",), "binary search bounds", "Binary search"),
    (("hash map", "hash table", "dictionary"), "hash table collision handling", "Hash tables"),
    (("transaction", "atomicity", "isolation"), "transaction isolation", "Transactions"),
    (("idempotent", "idempotency"), "idempotent request handling", "Idempotency"),
    (("cache", "caching"), "cache consistency", "Caching"),
    (("index", "indexes"), "index selection", "Indexes"),
    (("recursion", "recursive"), "recursion termination", "Recursion"),
    (("queue", "background job"), "queue retry handling", "Queues"),
]


def _claim_fragment(answer):
    """A short safe excerpt grounds unknown topics without copying a solution."""
    if not isinstance(answer, str) or _UNSAFE.search(answer) or _CODE.search(answer):
        return None
    clause = re.split(r"[.!?;\n]", answer.strip(), maxsplit=1)[0]
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]*", clause)
    if len(words) < 5 or any(len(word) > 30 for word in words):
        return None
    # Leave part of even a short answer out of the public question.
    fragment = " ".join(words[:min(8, len(words) - 2)])[:120]
    return fragment if len(fragment) >= 12 else None


def _fallback(context, questions, rubric, target, challenge_type):
    candidates = [(question, rubric) for question in questions]
    # These independent scenarios and reasoning tasks give 64 distinct
    # probes for the same target, beyond the twenty-turn history limit.
    # Changing numbers or a label alone would still be a near duplicate.
    scenarios = (
        "Use the smallest meaningful input or situation, then change exactly one assumption while keeping everything else fixed.",
        "Start from a case that succeeds, and extend it until it reaches the first boundary of your approach.",
        "Choose two inputs or situations with equal size but different structure, so that they exercise different decisions.",
        "Suppose an intermediate result is wrong even though the starting conditions are valid; consider how that affects what follows.",
        "Compare an ordinary example with one containing an absent, repeated, or extreme value that your approach must handle.",
        "Imagine a colleague questions one assumption and proposes an alternative path to the same goal; explore that objection using a concrete case.",
        "Remove one step or safeguard from an otherwise successful example, and examine whether its original conclusion still follows.",
        "Consider a case where the approach behaves correctly but uses more resources than expected; separate the correctness issue from the efficiency issue.",
    )
    tasks = (
        "Trace each important decision in order, predict the resulting behavior, and justify which invariant or rule remains valid throughout.",
        "Explain the source of any difference in outcome, identify which operations matter most, and describe how an independent check would detect a mistake.",
        "Construct a concrete example and a counterexample, then defend the distinction by connecting the steps to the claim in your answer.",
        "Compare the work and information required in both cases, state the assumptions behind your reasoning, and identify a limitation of the approach.",
        "Show where a plausible incorrect implementation or interpretation first goes wrong, describe a correction, and explain how you would verify it.",
        "State the result you expect before working through the case, explain why each step is necessary, and describe what would invalidate your prediction.",
        "Design a small manual check with a clearly stated expected outcome, explain what it establishes, and describe which errors it cannot rule out.",
        "Justify the choice made at the decisive step, compare it with a reasonable alternative, and explain which evidence would change your decision.",
    )
    reserve_rubric = ["Connect the chosen example to the verification target",
                      "Explain intermediate decisions and justify the predicted result",
                      "Identify a relevant assumption and a concrete correctness check"]
    candidates.extend((f"To verify “{target}”: {scenario} {task}", reserve_rubric)
                      for scenario in scenarios for task in tasks)
    for question, candidate_rubric in candidates:
        candidate = _normalise(question, candidate_rubric, target, challenge_type, context, "fallback")
        try:
            # Fallbacks meet the same privacy, application and history
            # contract as model output; there is no duplicate default.
            validated = validate_question(candidate, context)
        except ValueError:
            continue
        validated["generation_source"] = "fallback"
        return validated
    raise ValueError("No valid local verification probe for supplied context")


def fallback_question(context):
    """Return a deterministic probe grounded in the previous answer."""
    if context.get("previous_was_coding"):
        return _fallback(context, [
            "Walk through your submitted solution on a small input and on an empty or boundary input. Explain how its state changes, why it terminates, and its time and space complexity.",
            "Choose a boundary input for your submitted solution. Predict its result, trace the operations that produce it, and explain how you would detect an incorrect result.",
            "For your submitted solution, identify the operation that dominates runtime. Explain how doubling input size affects its work and which input could expose a correctness problem."],
            ["Trace the submitted algorithm's state accurately", "Explain boundary behavior and termination",
             "Justify time and space complexity from the operations performed"],
            "submitted solution execution and edge cases", "edge_case")
    answer = context.get("candidate_answer") or ""
    rubric = context.get("rubric_points") or []
    supported = " ".join([answer if isinstance(answer, str) else "",
                          *[point for point in rubric if isinstance(point, str)]]).casefold()
    concept = next(((target, topic) for markers, target, topic in _CONCEPTS
                    if any(marker in supported for marker in markers)), None)
    if concept and concept[1] == "Binary search":
        return _fallback(context, [
            "For binary search over 1,024 sorted values, trace the changing search bounds and worst-case comparisons. Explain how you handle a missing target and what changes for unsorted values.",
            "Trace binary search when the target falls between two adjacent sorted values. Explain the stopping condition and how inclusive versus exclusive bounds change the updates.",
            "Debug a binary search that repeats the same midpoint on a two-element range. Explain which bounds invariant you would check, propose a correction, and justify termination."],
            ["Trace successive comparisons while maintaining valid search bounds",
             "Explain termination for an absent target and the sorted-order requirement"],
            concept[0], "reasoning")
    if concept:
        target, topic = concept
        questions = [
            f"Apply {topic.lower()} to a concrete example related to your previous answer. Trace the important steps, explain one failure or boundary case, and justify your approach.",
            f"For the {topic.lower()} approach in your previous answer, choose a boundary or failure scenario. Predict the outcome and explain how you would test your reasoning.",
            f"Using {topic.lower()}, compare two approaches for the same concrete problem. Explain an invariant each must preserve and when your original choice needs to change."]
    else:
        fragment = _claim_fragment(answer)
        target = fragment or "previous answer's main approach"
        if fragment:
            questions = [
                f"You mentioned “{fragment}” in your answer. Apply that claim to a small example, walk through the steps, and explain a boundary case where the approach needs to change.",
                f"For your claim about “{fragment}”, choose a failure or boundary scenario. Predict what happens and explain how you would verify the outcome.",
                f"Examine the approach behind “{fragment}”. Describe an alternative for the same example and explain which conditions favor each approach."]
        else:
            questions = [
                "Choose one concrete claim or approach from your previous answer. Apply it to a small example, walk through the steps, and explain a boundary case where it needs to change.",
                "Take the main approach in your previous answer and choose a failure scenario. Predict its outcome, explain the intermediate steps, and describe how you would verify the result.",
                "Compare your previous answer's main approach with an alternative on a concrete example. Explain their assumptions and a boundary case that changes your choice."]
    return _fallback(context, questions,
                     ["Apply the selected claim accurately to a concrete example",
                      "Explain the intermediate steps and a meaningful limitation"],
                     target, "application")
