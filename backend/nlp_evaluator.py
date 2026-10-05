"""Lightweight NLP signals: filler-word counting and rubric retrieval."""
import re

# -------------------------------------------------------------
# BLOCK 1: Common spoken filler words
# -------------------------------------------------------------
# Nervous or stalling speakers use these often; the count feeds the
# communication and speech-fluency scores. Note that legitimate uses
# ("I like Python") are also counted, so the metric is an approximation.
COMMON_FILLER_WORDS = [
    "um",
    "umm",
    "uh",
    "uhh",
    "er",
    "erm",
    "ah",
    "hmm",
    "like",
    "you know",
    "actually",
    "basically",
    "so yeah",
    "literally",
    "sort of",
    "kind of"
]

# Compiled once at import. \b word boundaries match "like" but not the
# "like" inside "likely" or "dislike".
_FILLER_PATTERNS = [
    (word, re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE))
    for word in COMMON_FILLER_WORDS
]


# -------------------------------------------------------------
# BLOCK 2: Filler-word counter
# -------------------------------------------------------------
def count_filler_words(text: str) -> dict:
    """Count filler words in ``text``.

    Returns ``{"total_count": int, "breakdown": {word: count}}``; words that
    do not occur are omitted from the breakdown.
    """
    if not text or not text.strip():
        return {"total_count": 0, "breakdown": {}}

    breakdown = {}
    for word, pattern in _FILLER_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            breakdown[word] = count

    return {"total_count": sum(breakdown.values()), "breakdown": breakdown}


# -------------------------------------------------------------
# BLOCK 3: Rubric retrieval by cosine similarity (in PostgreSQL)
# -------------------------------------------------------------
# Calls the cosine_similarity(FLOAT8[], FLOAT8[]) SQL function defined in
# schema.sql to rank this question's rubric points against the answer.
def retrieve_top_rubric_matches(conn, interview_id: str, question_index: int, candidate_vector: list[float]):
    """Return ``(top_rubric_texts, best_similarity)`` for one question.

    At most three rubric points are returned, best first. An empty vector or
    a question without rubric rows yields ``([], 0.0)``.
    """
    if not candidate_vector:
        return [], 0.0

    # The explicit ::float8[] cast keeps function resolution unambiguous;
    # psycopg2 otherwise sends a Python float list as numeric[].
    query = """
        SELECT
            ideal_concept_chunk,
            cosine_similarity(embedding, %s::float8[]) AS similarity
        FROM question_rubrics
        WHERE interview_id = %s AND question_index = %s
        ORDER BY similarity DESC
        LIMIT 3;
    """

    with conn.cursor() as cur:
        cur.execute(query, (candidate_vector, interview_id, question_index))
        rows = cur.fetchall()

    if not rows:
        return [], 0.0

    rubric_points = [row["ideal_concept_chunk"] for row in rows]
    # Similarity is in [-1, 1]; for text embeddings it is in practice 0..1.
    highest_similarity = max(float(row["similarity"]) for row in rows)
    return rubric_points, highest_similarity


# -------------------------------------------------------------
# BLOCK 4: Stand-alone transcript scoring (used by the unit tests)
# -------------------------------------------------------------
def evaluate_candidate_transcript(candidate_roll_no: str, transcript: str, similarity_score: float) -> dict:
    """Score a transcript without the database or Gemini.

    Validates the inputs, counts filler words and derives a voice-confidence
    score (95 minus 2 per filler, clamped to 40..100) and an answer-quality
    score (similarity as a percentage).
    """
    if not candidate_roll_no or not candidate_roll_no.strip():
        raise ValueError("Candidate roll number cannot be empty")
    if not transcript or not transcript.strip():
        raise ValueError("Candidate transcript cannot be empty")
    if similarity_score < 0.0 or similarity_score > 1.0:
        raise ValueError("Similarity score must be between 0.0 and 1.0")

    filler_stats = count_filler_words(transcript)
    total_fillers = filler_stats["total_count"]
    voice_confidence = max(40, min(100, 95 - (total_fillers * 2)))
    answer_quality = round(similarity_score * 100)

    return {
        "candidate_roll_no": candidate_roll_no.strip(),
        "total_fillers": total_fillers,
        "filler_breakdown": filler_stats["breakdown"],
        "voice_confidence_score": voice_confidence,
        "answer_quality_score": answer_quality,
    }
