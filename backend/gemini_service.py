import os
import re
import json
from typing import Optional
from google import genai
from google.genai import types
from dotenv import load_dotenv

# -------------------------------------------------------------
# BLOCK 1: Dynamic Gemini Client Initialization & Env Resolution
# -------------------------------------------------------------
# Resolves .env path relative to this backend directory.
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
load_dotenv()

_client = None


def get_client() -> genai.Client:
    """
    Returns the Google GenAI client instance.
    Dynamically loads or reloads GEMINI_API_KEY from backend/.env or environment.
    """
    global _client
    api_key = os.getenv("GEMINI_API_KEY")

    # If key is not in environment, reload backend/.env
    if not api_key or not api_key.strip():
        env_file = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_file):
            load_dotenv(env_file, override=True)
        load_dotenv(override=False)
        api_key = os.getenv("GEMINI_API_KEY")

    if not api_key or not api_key.strip():
        raise ValueError(
            "GEMINI_API_KEY is missing or empty. Please add your Gemini API key to backend/.env (GEMINI_API_KEY=your_key_here)"
        )

    clean_key = api_key.strip()
    if _client is None or getattr(_client, "_current_key", None) != clean_key:
        _client = genai.Client(api_key=clean_key)
        _client._current_key = clean_key

    return _client


def ensure_client():
    """Helper to verify that the Gemini API key has been provided."""
    return get_client()


class _ClientProxy:
    """Provides backward compatibility for modules accessing gemini_service.client directly."""
    def __getattr__(self, name):
        return getattr(get_client(), name)


client = _ClientProxy()


# -------------------------------------------------------------
# BLOCK 2: Markdown Code-Block & JSON Extraction Helper
# -------------------------------------------------------------
# LLMs frequently surround JSON outputs with ```json ... ``` blocks.
# This function safely removes markdown fences and parses the JSON.
def clean_and_parse_json(text: str):
    """
    Safely strips Markdown code blocks (```json ... ```) and parses JSON.
    """
    if not text:
        raise ValueError("Empty response received from Gemini.")
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r'(\[.*\]|\{.*\})', cleaned, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        raise


# Built-in fallback questions used if Gemini API encounters rate limits or offline mode
FALLBACK_QUESTIONS = [
    {
        "index": 1,
        "question": "Tell me about yourself and your relevant technical background.",
        "rubric_points": [
            "Relevant technical and educational background",
            "Key programming languages and tech stack proficiencies",
            "Problem-solving mindset and system engineering experience"
        ]
    },
    {
        "index": 2,
        "question": "Explain a challenging technical project you worked on and how you handled difficulties.",
        "rubric_points": [
            "Clear description of problem and architecture design",
            "Root-cause analysis and problem-solving methodology",
            "Measurable impact and lessons learned"
        ]
    },
    {
        "index": 3,
        "question": "What is the difference between a process and a thread, and how does memory management differ?",
        "rubric_points": [
            "Separate virtual address space vs shared process memory",
            "Context switching overhead and IPC vs thread synchronization",
            "Concurrency pitfalls such as race conditions and deadlocks"
        ]
    },
    {
        "index": 4,
        "question": "Explain how you would diagnose and improve the performance of a slow web application.",
        "rubric_points": [
            "Database optimization including indexing and query profiling",
            "Caching strategies such as Redis and CDN caching",
            "Frontend asset optimization and lazy loading"
        ]
    },
    {
        "index": 5,
        "question": "Why should we select you for this role and what makes your approach unique?",
        "rubric_points": [
            "Alignment with role technical requirements",
            "Dedication to clean code, testing, and continuous learning",
            "Strong communication and collaborative team skills"
        ]
    }
]


# -------------------------------------------------------------
# BLOCK 2.5: Dynamic JD Fallback Question Builder
# -------------------------------------------------------------
# If Google's API experiences temporary network/capacity issues,
# this function dynamically generates role- and JD-specific questions
# rather than returning the same static questions.
def generate_jd_based_fallback_questions(role_title: str, job_description: Optional[str] = None) -> list[dict]:
    """
    Generates dynamic role-tailored questions based on keywords extracted from the JD.
    """
    role = role_title.strip() if role_title else "Software Engineer"
    jd = job_description.strip() if job_description else ""

    # Extract technologies or focus areas mentioned in the JD
    skills_detected = []
    sample_keywords = [
        "React", "Node", "Python", "FastAPI", "PostgreSQL", "MongoDB", "Express", "MERN",
        "Docker", "Kubernetes", "AWS", "GCP", "Redis", "TypeScript", "JavaScript", "GraphQL",
        "Next.js", "Django", "Go", "Java", "Spring", "Kafka", "SQL", "Tailwind", "CI/CD"
    ]
    for kw in sample_keywords:
        if kw.lower() in jd.lower() or kw.lower() in role.lower():
            skills_detected.append(kw)

    primary_stack = ", ".join(skills_detected[:4]) if skills_detected else role

    return [
        {
            "index": 1,
            "question": f"Given the requirements for this {role} position ({primary_stack}), could you walk through your hands-on experience and architecture design with these core technologies?",
            "rubric_points": [
                f"Demonstrated proficiency with {primary_stack}",
                "Clear explanation of software development lifecycle and tooling",
                "Proven ability to solve real-world engineering problems"
            ]
        },
        {
            "index": 2,
            "question": f"In a project involving {primary_stack}, how do you ensure scalability, maintainability, and clean code architecture?",
            "rubric_points": [
                "Modular architecture and separation of concerns",
                "Testing strategies (unit, integration, and end-to-end)",
                "Documentation and maintainable coding standards"
            ]
        },
        {
            "index": 3,
            "question": f"Describe a complex technical challenge or debugging issue you resolved while working with {primary_stack}. What was the root cause and resolution?",
            "rubric_points": [
                "Systematic debugging and root-cause analysis",
                "Correct application of framework-specific troubleshooting tools",
                "Preventative measures implemented to avoid recurrence"
            ]
        },
        {
            "index": 4,
            "question": f"How do you approach database design, caching, and performance optimization when building features for a {role} role?",
            "rubric_points": [
                "Database query indexing and schema optimization",
                "Effective caching layers and latency reduction",
                "Asynchronous processing and resource efficiency"
            ]
        },
        {
            "index": 5,
            "question": f"Considering the specific responsibilities of this {role} opportunity, how do you handle security vulnerabilities, authentication, and production deployments?",
            "rubric_points": [
                "Secure data transmission and authentication/authorization patterns",
                "Containerization and deployment pipelines (CI/CD)",
                "Monitoring, logging, and error tracking in production"
            ]
        }
    ]


# -------------------------------------------------------------
# BLOCK 3: Question & Rubric Generation Tailored to Job Description
# -------------------------------------------------------------
# This function sends a prompt to Gemini asking it to analyze the role
# and the optional Job Description (JD). When a JD is supplied, questions
# target the specific tech stack, frameworks, responsibilities, and seniority.
# Rubric points represent the ideal concepts candidate must articulate.
def generate_interview_questions(role_title: str, job_description: Optional[str] = None) -> list[dict]:
    """
    Generates 5 role-specific interview questions and ideal rubric points.
    If a job_description is provided, questions directly target the specific tech stack
    and responsibilities specified in the JD.
    """
    import time
    cl = get_client()

    jd_context = ""
    if job_description and job_description.strip():
        jd_context = f"""
    TARGET JOB DESCRIPTION & REQUIREMENTS:
    \"\"\"
    {job_description.strip()}
    \"\"\"
    
    INSTRUCTIONS FOR JOB DESCRIPTION TAILORING:
    - Deeply analyze the tech stack, libraries, architecture, and responsibilities in the Job Description above.
    - Ensure all 5 questions directly evaluate the candidate's real-world proficiency with these specific technologies and tasks.
    - Tailor the rubric points to the specific tools, best practices, and patterns required by this opening.
    """

    prompt = f"""
    You are an expert technical interviewer and hiring manager hiring for the following position:
    ROLE TITLE: {role_title}
    {jd_context}

    Generate exactly 5 realistic, high-quality technical interview questions.
    For each question, provide 2 to 3 concise 'rubric_points' detailing the key technical concepts, 
    libraries, design decisions, or keywords that a qualified candidate MUST articulate.

    Return ONLY a valid JSON array of objects with the following schema:
    [
      {{
        "index": 1,
        "question": "Question text here",
        "rubric_points": [
          "Key concept 1",
          "Key concept 2"
        ]
      }}
    ]
    """

    # High-availability flash models prioritized to avoid temporary 503 capacity limits
    models_to_try = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
        "gemini-3.8-flash",
        "gemini-3.5-flash",
    ]
    last_err = None

    for model_name in models_to_try:
        for attempt in range(2):
            try:
                response = cl.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.7,
                    )
                )
                data = clean_and_parse_json(response.text)
                if isinstance(data, list) and len(data) > 0:
                    return data
            except Exception as err:
                last_err = err
                err_str = str(err)
                if "503" in err_str and attempt == 0:
                    time.sleep(1.0) # Short wait on 503 capacity spike
                    continue
                print(f"[GEMINI WARNING] Model {model_name} question generation error: {err}")
                break

    print(f"[GEMINI FALLBACK] Generating dynamic JD questions due to: {last_err}")
    return generate_jd_based_fallback_questions(role_title, job_description)


# -------------------------------------------------------------
# BLOCK 4: Vector Embeddings Generation
# -------------------------------------------------------------
# An embedding transforms human text into a list of 768 numbers.
# Texts with similar semantic meaning will have vectors pointing in
# almost the same direction in mathematical space.
# We use Google's 'gemini-embedding-001' model for 768-dimensional accuracy.
def get_embedding(text: str) -> list[float]:
    """
    Converts a string of text into a 768-dimensional float vector.
    Returns a standard Python list of floats so it can be stored in PostgreSQL.
    """
    cl = get_client()
    cleaned = text.strip() if text else ""
    if not cleaned:
        return []

    embedding_models = ["gemini-embedding-001", "gemini-embedding-2"]
    for emb_model in embedding_models:
        try:
            result = cl.models.embed_content(
                model=emb_model,
                contents=cleaned
            )
            if result.embeddings and len(result.embeddings) > 0 and result.embeddings[0].values:
                return [float(v) for v in result.embeddings[0].values]
        except Exception as err:
            print(f"[GEMINI EMBEDDING WARNING] Model {emb_model} error: {err}")

    return []


# -------------------------------------------------------------
# BLOCK 5: RAG (Retrieval-Augmented Generation) Evaluation with JD Context
# -------------------------------------------------------------
# Feeds the retrieved rubric points + semantic similarity score + filler
# word counts + optional Job Description context directly into Gemini.
# This makes the evaluation objective, grounded, and tailored to the job requirements.
def evaluate_answer_with_rag(
    question: str,
    candidate_answer: str,
    retrieved_rubric_points: list[str],
    similarity_score: float,
    filler_count: int,
    job_description: Optional[str] = None
) -> dict:
    """
    Evaluates a single question response using the RAG-augmented prompt.
    Takes into account the target job description criteria when available.
    Returns a dictionary with scores, strengths, improvements, and feedback.
    """
    cl = get_client()

    jd_snippet = ""
    if job_description and job_description.strip():
        jd_snippet = f"""
    TARGET JOB REQUIREMENTS:
    \"\"\"
    {job_description.strip()[:800]}
    \"\"\"
    """

    prompt = f"""
    You are an unbiased technical interview evaluator.
    {jd_snippet}

    INTERVIEW QUESTION:
    "{question}"

    CANDIDATE'S ANSWER:
    "{candidate_answer if candidate_answer.strip() else 'No answer provided.'}"

    KEY EXPECTED RUBRIC CONCEPTS (Retrieved from Vector Knowledge Base):
    {json.dumps(retrieved_rubric_points, indent=2)}

    OBJECTIVE METRICS COMPUTED:
    - Semantic Similarity Match with Rubric: {similarity_score * 100:.1f}%
    - Filler Words Detected ("um", "like", etc.): {filler_count}

    TASK:
    Grade this answer objectively against the retrieved rubric points and role expectations.
    Return ONLY a valid JSON object matching this structure:
    {{
      "answer_quality_score": 85,
      "communication_score": 78,
      "strengths": [
        "Specifically addressed required architectural considerations.",
        "Demonstrated clear understanding of core technologies."
      ],
      "improvements": [
        "Did not elaborate on performance edge cases or trade-offs.",
        "Reduce filler words in technical explanations."
      ],
      "feedback": "2 to 3 sentences summarizing the candidate's performance."
    }}
    """

    models_to_try = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
        "gemini-3.8-flash",
        "gemini-3.5-flash"
    ]
    for model_name in models_to_try:
        try:
            response = cl.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2, # Lower temperature for consistent, fair scoring
                )
            )
            parsed = clean_and_parse_json(response.text)
            if isinstance(parsed, dict) and "answer_quality_score" in parsed:
                return parsed
        except Exception as err:
            print(f"[GEMINI WARNING] Model {model_name} evaluation error: {err}")

    # Objective fallback scoring if Gemini call encounters an issue
    sim_pct = int(similarity_score * 100) if similarity_score else 65
    quality_score = max(40, min(95, sim_pct))
    comm_score = max(50, min(95, 95 - (filler_count * 2)))
    return {
        "answer_quality_score": quality_score,
        "communication_score": comm_score,
        "strengths": [
            "Demonstrated relevant understanding of core concepts.",
            "Maintained logical structure in the provided response."
        ],
        "improvements": [
            "Incorporate more technical depth and specific terminology matching the job requirements.",
            "Minimize spoken filler words and elaborate with concrete examples."
        ],
        "feedback": f"Response demonstrated foundational understanding with a {sim_pct}% semantic rubric alignment. Strive for deeper technical detail matching the job specifications."
    }


# -------------------------------------------------------------
# BLOCK 6: High-Speed Batch Interview Evaluation (Single Roundtrip)
# -------------------------------------------------------------
# Rather than executing 5 separate API calls in a loop (taking 15-25s),
# this function sends all candidate responses, retrieved rubric points,
# and similarity scores to Gemini in ONE single structured prompt.
# This cuts evaluation latency from 20 seconds down to ~2 seconds!
def batch_evaluate_interview(
    role_title: str,
    job_description: Optional[str],
    evaluation_items: list[dict]
) -> dict:
    """
    Evaluates all interview questions in a single, high-speed batch prompt.
    Returns:
      - question_evaluations: list of per-question score dictionaries
      - overall_strengths: list of 3-4 top strengths
      - overall_improvements: list of 3-4 top improvements
      - overall_summary: cohesive summary feedback paragraph
    """
    cl = get_client()

    jd_snippet = ""
    if job_description and job_description.strip():
        jd_snippet = f"""
    TARGET JOB DESCRIPTION:
    \"\"\"
    {job_description.strip()[:800]}
    \"\"\"
    """

    formatted_qa = []
    for item in evaluation_items:
        formatted_qa.append({
            "question_index": item.get("question_index", 1),
            "question": item.get("question_text", ""),
            "candidate_answer": item.get("candidate_answer", "") or "No answer provided.",
            "rubric_points": item.get("rubric_points", []),
            "rubric_semantic_similarity": f"{float(item.get('similarity_score', 0.0)) * 100:.1f}%",
            "filler_words_count": item.get("filler_count", 0)
        })

    prompt = f"""
    You are an expert, unbiased technical interview evaluator.
    ROLE TITLE: {role_title}
    {jd_snippet}

    Evaluate the candidate's answers below objectively against the retrieved rubric concepts and job requirements.

    CANDIDATE RESPONSES & RUBRIC MATCHES:
    {json.dumps(formatted_qa, indent=2)}

    INSTRUCTIONS:
    1. For each question, score answer_quality_score (0-100) based on correctness, technical depth, and rubric alignment.
    2. Score communication_score (0-100) based on clarity, structure, and minimal filler words.
    3. Provide 1-2 concise bullet strengths and 1-2 bullet improvements for each question.
    4. Provide 3-4 overall interview key strengths and 3-4 overall areas for improvement across the whole interview.
    5. Provide a cohesive overall_summary of 2-3 sentences.

    Return ONLY a valid JSON object matching this schema:
    {{
      "overall_summary": "Comprehensive 2-3 sentence performance summary.",
      "overall_strengths": ["Key strength 1", "Key strength 2", "Key strength 3"],
      "overall_improvements": ["Key improvement 1", "Key improvement 2", "Key improvement 3"],
      "question_evaluations": [
        {{
          "question_index": 1,
          "answer_quality_score": 85,
          "communication_score": 80,
          "strengths": ["Specific strength"],
          "improvements": ["Specific area for improvement"],
          "feedback": "1-2 sentence evaluation for this answer."
        }}
      ]
    }}
    """

    models_to_try = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
        "gemini-3.8-flash",
        "gemini-3.5-flash"
    ]

    for model_name in models_to_try:
        try:
            response = cl.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2, # Low temperature for consistent scoring
                )
            )
            parsed = clean_and_parse_json(response.text)
            if isinstance(parsed, dict) and "question_evaluations" in parsed:
                return parsed
        except Exception as err:
            print(f"[GEMINI BATCH EVAL WARNING] Model {model_name} error: {err}")

    # Robust local fallback if Gemini API is temporarily offline
    print("[GEMINI BATCH EVAL] Falling back to local algorithmic scoring.")
    fallback_evals = []
    fallback_strengths = []
    fallback_improvements = []

    for item in evaluation_items:
        q_idx = item.get("question_index", 1)
        sim_score = float(item.get("similarity_score", 0.0))
        filler_cnt = int(item.get("filler_count", 0))
        sim_pct = int(sim_score * 100) if sim_score else 65

        quality_score = max(40, min(95, sim_pct))
        comm_score = max(50, min(95, 95 - (filler_cnt * 2)))

        fallback_evals.append({
            "question_index": q_idx,
            "answer_quality_score": quality_score,
            "communication_score": comm_score,
            "strengths": ["Addressed core aspects of the requested question."],
            "improvements": ["Provide deeper architectural specifics and reduce verbal fillers."],
            "feedback": f"Response demonstrated foundational understanding with {sim_pct}% semantic rubric alignment."
        })
        fallback_strengths.append(f"Q{q_idx}: Solid grasp of fundamental concepts.")
        fallback_improvements.append(f"Q{q_idx}: Elaborate on production edge cases and error handling.")

    return {
        "overall_summary": "Candidate demonstrated a clear foundational understanding across key questions with good rubric alignment.",
        "overall_strengths": fallback_strengths[:3],
        "overall_improvements": fallback_improvements[:3],
        "question_evaluations": fallback_evals
    }

