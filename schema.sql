-- AI Interview Evaluation System - PostgreSQL Schema
--
-- Safe to re-run: every statement is additive or idempotent, so existing
-- installations are migrated in place. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql

-- 0. gen_random_uuid() is built in from PostgreSQL 13; on 12 and older it
-- comes from pgcrypto. Creating the extension is harmless on newer versions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Candidates / Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid VARCHAR(255),
    email VARCHAR(255),
    full_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migration-safe Firebase identity upgrade for existing databases.
-- Add the column as nullable, preserve every legacy user with a deterministic
-- non-Firebase identifier, then enforce the final uniqueness/nullability rules.
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255);

UPDATE users
SET firebase_uid = 'legacy:' || id::text
WHERE firebase_uid IS NULL OR BTRIM(firebase_uid) = '';

ALTER TABLE users ALTER COLUMN firebase_uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique_idx ON users (firebase_uid);

-- Firebase UID is the stable external identity. Email and display name are
-- profile metadata and may be absent or change over time.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

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
-- One row per private rubric point with its embedding. Embeddings are
-- requested at a fixed 768 dimensions (EMBEDDING_DIMENSIONS); the array is
-- empty when the embedding service was unavailable.
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

-- 4b. Adaptive interview metadata
-- Additive migrations preserve legacy sessions/responses.
ALTER TABLE interviews
    ADD COLUMN IF NOT EXISTS current_difficulty VARCHAR(10) NOT NULL DEFAULT 'medium'
        CHECK (current_difficulty IN ('easy', 'medium', 'hard', 'expert')),
    ADD COLUMN IF NOT EXISTS interview_mode VARCHAR(20) NOT NULL DEFAULT 'standard'
        CHECK (interview_mode IN ('standard', 'game')),
    ADD COLUMN IF NOT EXISTS current_turn INT NOT NULL DEFAULT 1 CHECK (current_turn >= 1),
    ADD COLUMN IF NOT EXISTS max_turns INT NOT NULL DEFAULT 5 CHECK (max_turns BETWEEN 1 AND 20);

-- Replace the previous inline mode constraint for existing installations.
-- A single ALTER is atomic and preserves all rows; rerunning is safe.
ALTER TABLE interviews
    DROP CONSTRAINT IF EXISTS interviews_interview_mode_check,
    ADD CONSTRAINT interviews_interview_mode_check
        CHECK (interview_mode IN ('standard', 'game'));

-- Questions must exist before answers; keeping them separate also preserves
-- unanswered turns and their metadata when embedding generation is unavailable.
CREATE TABLE IF NOT EXISTS interview_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    question_index INT NOT NULL CHECK (question_index >= 1),
    question_text TEXT NOT NULL,
    difficulty VARCHAR(10) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
    is_follow_up BOOLEAN NOT NULL DEFAULT FALSE,
    topic TEXT NOT NULL,
    adaptive_reason TEXT NOT NULL,
    rubric_points JSONB NOT NULL CHECK (jsonb_typeof(rubric_points) = 'array'),
    UNIQUE (interview_id, question_index)
);

ALTER TABLE interview_responses
    ADD COLUMN IF NOT EXISTS question_id UUID UNIQUE REFERENCES interview_questions(id),
    ADD COLUMN IF NOT EXISTS difficulty VARCHAR(10)
        CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
    ADD COLUMN IF NOT EXISTS answer_quality_score INT CHECK (answer_quality_score BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS communication_score INT CHECK (communication_score BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS feedback TEXT,
    ADD COLUMN IF NOT EXISTS strengths JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS improvements JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS missing_concepts JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS is_follow_up BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS adaptive_reason TEXT,
    ADD COLUMN IF NOT EXISTS topic TEXT,
    ADD COLUMN IF NOT EXISTS filler_metrics JSONB,
    ADD COLUMN IF NOT EXISTS evaluation_source VARCHAR(20),
    ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_result JSONB;

-- 5. Comprehensive Evaluation Reports
-- camera_engagement_score is NULL when the browser's camera model produced
-- no data; the overall score is then re-weighted without it.
CREATE TABLE IF NOT EXISTS evaluation_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    answer_quality_score INT,
    communication_score INT,
    -- Retained only for compatibility with reports created before finalization.
    voice_confidence_score INT,
    speech_fluency_score INT,
    camera_engagement_score INT,
    overall_score INT,
    vision_metrics JSONB,
    nlp_metrics JSONB,
    strengths TEXT[],
    improvements TEXT[],
    summary_feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE evaluation_reports
    ADD COLUMN IF NOT EXISTS speech_fluency_score INT;

-- 6. Cosine Similarity Function for Vector Embeddings
-- Returns 0 for empty, mismatched-length or zero vectors.
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

-- 7. Interview Arena
-- Arena keeps its game state separate from professional evaluations.
ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS boss_round BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS arena_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    total_xp INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
    current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
    best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= current_streak),
    highest_difficulty VARCHAR(10) NOT NULL DEFAULT 'medium'
        CHECK (highest_difficulty IN ('easy', 'medium', 'hard', 'expert')),
    hint_used BOOLEAN NOT NULL DEFAULT FALSE,
    hint_turn INTEGER CHECK (hint_turn BETWEEN 1 AND 6),
    hint_text TEXT,
    boss_score INTEGER CHECK (boss_score BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS arena_turns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    response_id UUID NOT NULL UNIQUE REFERENCES interview_responses(id) ON DELETE CASCADE,
    game_result JSONB NOT NULL CHECK (jsonb_typeof(game_result) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 8. Indexes for the hot lookups
CREATE INDEX IF NOT EXISTS arena_turns_interview_idx ON arena_turns(interview_id);
CREATE INDEX IF NOT EXISTS question_rubrics_lookup_idx ON question_rubrics(interview_id, question_index);
CREATE INDEX IF NOT EXISTS interviews_user_created_idx ON interviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interview_questions_interview_idx ON interview_questions(interview_id);
CREATE INDEX IF NOT EXISTS interview_responses_interview_idx ON interview_responses(interview_id);
