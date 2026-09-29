import re

# -------------------------------------------------------------
# BLOCK 1: List of Common Spoken Filler Words
# -------------------------------------------------------------
# In professional interviews, candidates frequently use filler words
# when nervous or stalling. We track these to measure communication quality.
COMMON_FILLER_WORDS = [
    "um",
    "uh",
    "er",
    "ah",
    "like",
    "you know",
    "actually",
    "basically",
    "so yeah",
    "literally",
    "sort of",
    "kind of"
]


# -------------------------------------------------------------
# BLOCK 2: NLP Filler Word Counter
# -------------------------------------------------------------
# Uses regular expressions with word boundary checks (\b) so that
# the word "like" is detected, but not inside words like "likely" or "dislike".
def count_filler_words(text: str) -> dict:
    """
    Scans candidate text and returns:
    1. 'total_count': Total number of filler occurrences
    2. 'breakdown': A dictionary showing how many times each filler word was spoken
    """
    if not text or not text.strip():
        return {"total_count": 0, "breakdown": {}}

    breakdown = {}
    total_count = 0

    for word in COMMON_FILLER_WORDS:
        # \b ensures we match the whole word, not substrings
        pattern = r'\b' + re.escape(word) + r'\b'
        matches = re.findall(pattern, text, flags=re.IGNORECASE)
        count = len(matches)
        if count > 0:
            breakdown[word] = count
            total_count += count

    return {
        "total_count": total_count,
        "breakdown": breakdown
    }


# -------------------------------------------------------------
# BLOCK 3: Vector Similarity Search using PostgreSQL Function
# -------------------------------------------------------------
# This function queries the 'question_rubrics' table.
# It calls the custom 'cosine_similarity(embedding, candidate_embedding)'
# function we created in PostgreSQL to find which ideal rubric concepts
# match closest to what the candidate said.
def retrieve_top_rubric_matches(conn, interview_id: str, question_index: int, candidate_vector: list[float]):
    """
    Executes Cosine Similarity in PostgreSQL.
    Retrieves the top matching rubric points and the highest similarity score.
    Returns: (list_of_rubric_texts, highest_similarity_score)
    """
    if not candidate_vector or len(candidate_vector) == 0:
        return [], 0.0

    query = """
        SELECT 
            ideal_concept_chunk,
            cosine_similarity(embedding, %s) AS similarity
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
    # Similarity will be a float between 0.0 and 1.0
    highest_similarity = max(float(row["similarity"]) for row in rows)

    return rubric_points, highest_similarity


# -------------------------------------------------------------
# BLOCK 4: Candidate Transcript Evaluation & Quality Scoring
# -------------------------------------------------------------
def evaluate_candidate_transcript(candidate_roll_no: str, transcript: str, similarity_score: float) -> dict:
    """
    Evaluates candidate transcript, verifies input integrity, counts filler words,
    and computes voice confidence and answer quality scores.
    """
    if not candidate_roll_no or not candidate_roll_no.strip():
        raise ValueError("Candidate roll number cannot be empty")
    if not transcript or not transcript.strip():
        raise ValueError("Candidate transcript cannot be empty")
    if similarity_score < 0.0 or similarity_score > 1.0:
        raise ValueError("Similarity score must be between 0.0 and 1.0")

    filler_stats = count_filler_words(transcript)
    total_fillers = filler_stats["total_count"]
    # Baseline voice confidence 95 minus 2 points per filler word, clamped to [40, 100]
    voice_confidence = max(40, min(100, 95 - (total_fillers * 2)))
    answer_quality = round(similarity_score * 100)

    return {
        "candidate_roll_no": candidate_roll_no.strip(),
        "total_fillers": total_fillers,
        "filler_breakdown": filler_stats["breakdown"],
        "voice_confidence_score": voice_confidence,
        "answer_quality_score": answer_quality,
    }

