"""Validated question content and deterministic offline question generation."""
from difflib import SequenceMatcher

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


def boss_fallback(context):
    description = (context['role_title'] + ' ' + (context.get('job_description') or '')).lower()
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


def fallback_question(context):
    if context.get('boss_round'):
        return boss_fallback(context)
    description = (context["role_title"] + " " + (context.get("job_description") or "")).lower()
    category = next((name for name, keywords in [
        ("frontend", ("frontend", "front-end", "react", "browser")),
        ("database", ("database", "sql", "postgres")),
        ("backend", ("backend", "back-end", "api", "service")),
        ("programming", ("python", "java", "programming")),
    ] if any(word in description for word in keywords)), "software")
    history = context.get("recent_history", [])
    used = {item["topic"].casefold() for item in history}
    follow_up = context.get("is_follow_up", False)
    if follow_up:
        # Keep the topic identity stable even if Gemini would rename the subtopic.
        topic = context["previous_topic"]
        gap = context["missing_concepts"][0][:100]
        question = f"In your previous answer about {topic}, how would you apply {gap} in a concrete example?"
        rubric = [f"Accurate explanation of {gap}", "Concrete application connected to the prior answer"]
    else:
        topic = next(t for t in TOPICS[category] + EXTRA_TOPICS if t.casefold() not in used)
        difficulty = context["current_difficulty"]
        templates = {
            "easy": f"What problem does {topic.lower()} solve in a simple application?",
            "medium": f"How would you apply {topic.lower()} in a project for this role?",
            "hard": f"How would you handle the trade-offs of {topic.lower()} under concurrent production load?",
            "expert": f"How would you design and validate {topic.lower()} at scale during partial failures?",
        }
        question = templates[difficulty]
        rubric = {
            "easy": ["Accurate basic purpose", "Simple relevant example"],
            "medium": ["Correct implementation approach", "Relevant example and limitation"],
            "hard": ["Concurrency and performance trade-offs", "Failure handling", "Validation strategy"],
            "expert": ["Explicit invariants and failure model", "Scale and availability trade-offs", "Recovery and verification"],
        }[difficulty]
    return {
        "question": question, "difficulty": context["current_difficulty"],
        "is_follow_up": follow_up, "topic": topic,
        "adaptive_reason": "Fallback question generated because the AI question service was unavailable.",
        "rubric_points": rubric,
        "boss_round": bool(context.get("boss_round")),
    }


def validate_question(data, context):
    if not isinstance(data, dict):
        raise ValueError("Question must be an object")
    if (data.get("difficulty") != context["current_difficulty"]
            or data.get("is_follow_up") is not context.get("is_follow_up", False)):
        # Relabelling an easy question as hard would not validate its content.
        raise ValueError("Question does not match backend policy")
    for key, limit in (("question", 1200), ("topic", 120), ("adaptive_reason", 500)):
        if not isinstance(data.get(key), str) or not data[key].strip() or len(data[key]) > limit:
            raise ValueError(f"Invalid {key}")
    rubric = data.get("rubric_points")
    if not isinstance(rubric, list) or not 1 <= len(rubric) <= 8 or any(
        not isinstance(point, str) or not point.strip() or len(point) > 500 for point in rubric
    ):
        raise ValueError("Invalid rubric")
    if context.get('boss_round') and (data.get('boss_round') is not True
            or len(rubric) not in (4, 5, 6) or data['difficulty'] not in ('hard', 'expert')
            or data['is_follow_up']):
        raise ValueError('Invalid Boss Round contract')
    question_text = " ".join(data["question"].casefold().split())
    if any(len(point.strip()) >= 24 and " ".join(point.casefold().split()) in question_text
           for point in rubric):
        raise ValueError("Private rubric included in question")
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
