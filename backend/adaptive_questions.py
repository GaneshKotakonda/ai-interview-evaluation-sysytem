"""Question validation and the deterministic offline question generator.

``validate_question`` checks Gemini output against the backend's decisions.
``fallback_question`` produces a usable question with no network at all,
so an interview can always continue.
"""
from difflib import SequenceMatcher

# -------------------------------------------------------------
# BLOCK 1: Offline topic bank
# -------------------------------------------------------------
# Each role category gets five specific topics, followed by a shared pool.
# 5 + 20 = 25 topics per category, more than the 20-turn maximum, so a
# session never runs out of unused topics.
TOPICS = {
    "frontend": ["UI state", "Browser rendering", "Accessibility", "Client caching", "Form validation"],
    "backend": ["API contracts", "Authentication", "Background jobs", "Service timeouts", "Concurrent updates"],
    "database": ["Indexes", "Transactions", "Schema design", "Query planning", "Database replication"],
    "programming": ["Data structures", "Error handling", "Iteration", "Memory ownership", "Testing"],
    "software": ["Module boundaries", "Code review", "Debugging", "Version control", "Dependency management"],
}
EXTRA_TOPICS = [
    "Input validation", "Observability", "Configuration", "Resource limits",
    "Deployment", "Compatibility", "Data serialization", "Integration testing",
    "Performance measurement", "Incident diagnosis", "Security boundaries",
    "Documentation", "Release testing", "Data migration", "Failure isolation",
    "Capacity planning", "Rollback", "Dependency upgrades", "Request tracing", "Load testing",
]

# Keyword → category, checked in order against role title + job description.
CATEGORY_KEYWORDS = [
    ("frontend", ("frontend", "front-end", "react", "browser")),
    ("database", ("database", "sql", "postgres")),
    ("backend", ("backend", "back-end", "api", "service")),
    ("programming", ("python", "java", "programming")),
]


def _description(context):
    """Lower-cased role title + job description used for keyword matching."""
    return (context["role_title"] + " " + (context.get("job_description") or "")).lower()


# -------------------------------------------------------------
# BLOCK 2: Offline Boss Round scenarios (Arena final turn)
# -------------------------------------------------------------
def boss_fallback(context):
    """Pick a multi-step practical scenario matching the role keywords."""
    description = _description(context)
    choices = [
        (('react', 'frontend', 'front-end'), 'Frontend performance',
         'Your web dashboard renders 20,000 changing records and becomes unresponsive. How would you diagnose the bottleneck, redesign the rendering strategy, and verify the improvement?',
         ['Profile rendering and interactions', 'Virtualize large lists', 'Paginate data and bound payload size', 'Avoid unnecessary renders', 'Measure interaction latency']),
        (('sql', 'database'), 'Database performance',
         'A query over millions of records now takes 12 seconds under load. How would you investigate the regression, choose optimizations, and safely validate them?',
         ['Inspect query execution plans', 'Choose selective indexes', 'Measure cardinality and statistics', 'Check lock contention', 'Benchmark representative workloads']),
        (('java',), 'Concurrent Java services',
         'A multithreaded Java service produces inconsistent results under peak load. How would you reproduce the issue, reason about shared state, and validate a reliable fix?',
         ['Reproduce races with stress tests', 'Identify shared mutable state', 'Explain visibility and synchronization', 'Compare locks and concurrent collections', 'Test correctness and throughput']),
        (('backend', 'api', 'python'), 'Resilient API design',
         'Your API traffic suddenly increases 100x and the database begins timing out. Design a response that keeps the service available, protects downstream systems, and verifies recovery.',
         ['Apply rate limits and backpressure', 'Use caching appropriately', 'Bound database connection pools', 'Queue noncritical work', 'Monitor saturation and test failures']),
        (('algorithm', 'data structure', 'programming'), 'Streaming algorithms',
         'You must process millions of events with limited memory while continuously returning the top 100 values. Explain your algorithm, its complexity, and how you would handle duplicates and failures.',
         ['Maintain a bounded heap', 'Analyze time and space complexity', 'Define duplicate semantics', 'Handle streaming input incrementally', 'Validate boundary cases']),
    ]
    # Generic default when no keyword matches.
    topic, question, rubric = ('Reliable service design',
        'Design a service that remains reliable during a sudden traffic spike. Explain how you would identify bottlenecks, protect scarce resources, and validate the design under failure.',
        ['Estimate workload and capacity', 'Bound resource usage', 'Isolate failures', 'Design recovery behavior', 'Test and monitor service objectives'])
    for keywords, candidate_topic, candidate_question, candidate_rubric in choices:
        if any(word in description for word in keywords):
            topic, question, rubric = candidate_topic, candidate_question, candidate_rubric
            break
    return dict(question=question, topic=topic, rubric_points=rubric,
                difficulty=context['current_difficulty'], is_follow_up=False, boss_round=True,
                adaptive_reason='Fallback Boss Round: practical multi-concept reasoning.')


# -------------------------------------------------------------
# BLOCK 3: Offline question generator
# -------------------------------------------------------------
QUESTION_TEMPLATES = {
    "easy": "What problem does {topic} solve in a simple application?",
    "medium": "How would you apply {topic} in a project for this role?",
    "hard": "How would you handle the trade-offs of {topic} under concurrent production load?",
    "expert": "How would you design and validate {topic} at scale during partial failures?",
}
RUBRIC_TEMPLATES = {
    "easy": ["Accurate basic purpose", "Simple relevant example"],
    "medium": ["Correct implementation approach", "Relevant example and limitation"],
    "hard": ["Concurrency and performance trade-offs", "Failure handling", "Validation strategy"],
    "expert": ["Explicit invariants and failure model", "Scale and availability trade-offs", "Recovery and verification"],
}


def fallback_question(context):
    """Build a question from templates; honours difficulty and follow-up."""
    if context.get('boss_round'):
        return boss_fallback(context)

    # Step A: Choose a topic category from role keywords.
    description = _description(context)
    category = next(
        (name for name, keywords in CATEGORY_KEYWORDS if any(word in description for word in keywords)),
        "software",
    )
    history = context.get("recent_history", [])
    used = {item["topic"].casefold() for item in history}
    follow_up = context.get("is_follow_up", False)

    if follow_up:
        # Step B: Follow-ups stay on the previous topic and probe the first gap.
        topic = context["previous_topic"]
        gap = context["missing_concepts"][0][:100]
        question = f"In your previous answer about {topic}, how would you apply {gap} in a concrete example?"
        rubric = [f"Accurate explanation of {gap}", "Concrete application connected to the prior answer"]
    else:
        # Step C: Otherwise take the first unused topic at the chosen difficulty.
        pool = TOPICS[category] + EXTRA_TOPICS
        topic = next((t for t in pool if t.casefold() not in used), pool[len(history) % len(pool)])
        difficulty = context["current_difficulty"]
        question = QUESTION_TEMPLATES[difficulty].format(topic=topic.lower())
        rubric = list(RUBRIC_TEMPLATES[difficulty])

    return {
        "question": question, "difficulty": context["current_difficulty"],
        "is_follow_up": follow_up, "topic": topic,
        "adaptive_reason": "Fallback question generated because the AI question service was unavailable.",
        "rubric_points": rubric,
        "boss_round": bool(context.get("boss_round")),
    }


# -------------------------------------------------------------
# BLOCK 4: Validation of model-generated questions
# -------------------------------------------------------------
def validate_question(data, context):
    """Return a normalised question dict or raise ``ValueError``.

    Rejects output that changes the backend's difficulty/follow-up/Boss Round
    decision, has missing or oversized fields, leaks a rubric point into the
    question, or repeats an earlier question or topic.
    """
    if not isinstance(data, dict):
        raise ValueError("Question must be an object")

    # Policy fields must match exactly; relabelling an easy question as hard
    # would not make its content hard.
    if (data.get("difficulty") != context["current_difficulty"]
            or data.get("is_follow_up") is not context.get("is_follow_up", False)):
        raise ValueError("Question does not match backend policy")

    # Required text fields with length limits.
    for key, limit in (("question", 1200), ("topic", 120), ("adaptive_reason", 500)):
        if not isinstance(data.get(key), str) or not data[key].strip() or len(data[key]) > limit:
            raise ValueError(f"Invalid {key}")

    rubric = data.get("rubric_points")
    if not isinstance(rubric, list) or not 1 <= len(rubric) <= 8 or any(
        not isinstance(point, str) or not point.strip() or len(point) > 500 for point in rubric
    ):
        raise ValueError("Invalid rubric")

    # Boss Round contract: 4-6 rubric points, hard/expert, never a follow-up.
    if context.get('boss_round') and (data.get('boss_round') is not True
            or len(rubric) not in (4, 5, 6) or data['difficulty'] not in ('hard', 'expert')
            or data['is_follow_up']):
        raise ValueError('Invalid Boss Round contract')

    # The question must not contain its own answer key.
    question_text = " ".join(data["question"].casefold().split())
    if any(len(point.strip()) >= 24 and " ".join(point.casefold().split()) in question_text
           for point in rubric):
        raise ValueError("Private rubric included in question")

    # No near-duplicate questions (>= 85% similar) and no repeated topics.
    for old in context.get("recent_history", []):
        if SequenceMatcher(None, old.get("question", "").casefold(),
                           data["question"].casefold()).ratio() >= 0.85:
            raise ValueError("Repeated question")
        if not context.get("is_follow_up") and old["topic"].casefold() == data["topic"].casefold():
            raise ValueError("Repeated topic")

    # Topic identity is owned by the backend during a follow-up.
    return {
        "question": data["question"].strip(),
        "difficulty": context["current_difficulty"],
        "is_follow_up": context.get("is_follow_up", False),
        "topic": context["previous_topic"] if context.get("is_follow_up") else data["topic"].strip(),
        "adaptive_reason": data["adaptive_reason"].strip(),
        "rubric_points": rubric,
        "boss_round": bool(context.get("boss_round")),
    }
