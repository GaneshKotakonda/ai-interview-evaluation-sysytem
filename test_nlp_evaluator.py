# test_nlp_evaluator.py
# Pytest unit tests for AI Interview Evaluation System - NLP Evaluator Module
# Student Name: Shaik Shafreed | Roll No: 2024BCS0113

import os
import sys
import pytest

# Add project backend directory to Python path
PROJECT_BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
if PROJECT_BACKEND_DIR not in sys.path:
    sys.path.insert(0, PROJECT_BACKEND_DIR)

from nlp_evaluator import (
    count_filler_words,
    evaluate_candidate_transcript,
    retrieve_top_rubric_matches,
)


# -------------------------------------------------------------------------
# Test Case 1 (TC-PY-01): Positive Pytest Test Case
# Objective: Verify NLP filler-word detection (word-boundary regex) and
#            voice confidence & answer quality scoring for candidate
#            Shaik Shafreed (2024BCS0113).
# -------------------------------------------------------------------------
def test_tc_py_01_candidate_2024BCS0113_nlp_scoring():
    candidate_roll_no = "2024BCS0113"
    transcript = (
        "Hello, I am Shaik Shafreed, Roll Number 2024BCS0113. "
        "Um, in our AI Interview Evaluation System, I built the NLP pipeline, "
        "and like, it uses cosine similarity likely for rubric matching, you know."
    )
    similarity_score = 0.88

    result = evaluate_candidate_transcript(
        candidate_roll_no=candidate_roll_no,
        transcript=transcript,
        similarity_score=similarity_score,
    )

    print(f"\n[TC-PY-01] Candidate Roll No : {result['candidate_roll_no']}")
    print(f"[TC-PY-01] Filler Breakdown  : {result['filler_breakdown']} (Total: {result['total_fillers']})")
    print(f"[TC-PY-01] Voice Confidence  : {result['voice_confidence_score']}/100")
    print(f"[TC-PY-01] Answer Quality    : {result['answer_quality_score']}/100")

    # Assert student-specific roll number and accurate filler word extraction
    assert result["candidate_roll_no"] == "2024BCS0113"
    assert result["total_fillers"] == 3
    assert result["filler_breakdown"] == {"um": 1, "like": 1, "you know": 1}
    # Verify "likely" was NOT falsely counted as "like" (word boundary check)
    assert result["filler_breakdown"].get("like") == 1
    # Voice confidence = 95 - (3 * 2) = 89
    assert result["voice_confidence_score"] == 89
    assert result["answer_quality_score"] == 88


# -------------------------------------------------------------------------
# Test Case 2 (TC-PY-02): Negative Pytest Test Case
# Objective: Verify that invalid/negative inputs (empty transcript or
#            out-of-range similarity score) for candidate 2024BCS0113
#            raise ValueError and empty embedding vectors safely return 0.0.
# -------------------------------------------------------------------------
def test_tc_py_02_candidate_2024BCS0113_negative_invalid_inputs():
    # 1. Empty/whitespace transcript for candidate 2024BCS0113 must raise ValueError
    with pytest.raises(ValueError, match="Candidate transcript cannot be empty") as exc_empty:
        evaluate_candidate_transcript(
            candidate_roll_no="2024BCS0113",
            transcript="   ",
            similarity_score=0.85,
        )
    print(f"\n[TC-PY-02] Caught Expected Error (Empty Transcript) : {exc_empty.value}")

    # 2. Negative similarity score (-0.25) for Shaik Shafreed (2024BCS0113) must raise ValueError
    with pytest.raises(ValueError, match="Similarity score must be between 0.0 and 1.0") as exc_bounds:
        evaluate_candidate_transcript(
            candidate_roll_no="2024BCS0113",
            transcript="Shaik Shafreed (2024BCS0113) explained microservice architecture.",
            similarity_score=-0.25,
        )
    print(f"[TC-PY-02] Caught Expected Error (Invalid Score)    : {exc_bounds.value}")

    # 3. Empty candidate vector in rubric matcher safely returns ([], 0.0)
    rubrics, max_sim = retrieve_top_rubric_matches(
        conn=None,
        interview_id="2024BCS0113-session",
        question_index=1,
        candidate_vector=[],
    )
    print(f"[TC-PY-02] Empty Vector Fallback -> rubrics={rubrics}, similarity={max_sim}")
    assert rubrics == []
    assert max_sim == 0.0
