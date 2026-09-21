-- AI Interview Evaluation System - PostgreSQL Schema

-- 1. Candidates / Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Interview Sessions Table
CREATE TABLE IF NOT EXISTS interviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_title VARCHAR(100) NOT NULL,
    job_description TEXT,
    status VARCHAR(50) DEFAULT 'in_progress',
    duration_seconds INT DEFAULT 0,
    overall_score INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 3. Question Rubrics (Vector Storage for RAG Evaluation)
-- Stores key concept chunks & 768-dimensional embeddings (Gemini text-embedding-004)
CREATE TABLE IF NOT EXISTS question_rubrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
    question_index INT NOT NULL,
    question_text TEXT NOT NULL,
    ideal_concept_chunk TEXT NOT NULL,
    embedding FLOAT8[] NOT NULL
);

-- 4. Candidate Question Responses & Uploaded Video
CREATE TABLE IF NOT EXISTS interview_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE,
    question_index INT NOT NULL,
    question_text TEXT NOT NULL,
    candidate_answer TEXT,
    answer_embedding FLOAT8[],
    semantic_similarity_score FLOAT,
    video_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Comprehensive Evaluation Reports
CREATE TABLE IF NOT EXISTS evaluation_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    answer_quality_score INT,
    communication_score INT,
    voice_confidence_score INT,
    camera_engagement_score INT,
    overall_score INT,
    vision_metrics JSONB,
    nlp_metrics JSONB,
    strengths TEXT[],
    improvements TEXT[],
    summary_feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Cosine Similarity Function for Vector Embeddings
CREATE OR REPLACE FUNCTION cosine_similarity(a FLOAT8[], b FLOAT8[])
RETURNS FLOAT8 AS $$
DECLARE
    dot FLOAT8 := 0;
    norm_a FLOAT8 := 0;
    norm_b FLOAT8 := 0;
    i INT;
BEGIN
    IF array_length(a, 1) IS NULL OR array_length(b, 1) IS NULL OR array_length(a, 1) <> array_length(b, 1) THEN
        RETURN 0;
    END IF;
    FOR i IN 1..array_length(a, 1) LOOP
        dot := dot + (a[i] * b[i]);
        norm_a := norm_a + (a[i] * a[i]);
        norm_b := norm_b + (b[i] * b[i]);
    END LOOP;
    IF norm_a = 0 OR norm_b = 0 THEN
        RETURN 0;
    END IF;
    RETURN dot / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
