# IntervueAI — Adaptive Multimodal AI Interview Coach

IntervueAI is an interview-coaching platform that evaluates each response before choosing the next challenge. It provides a professional Standard Interview and a separate gamified Interview Arena. It is a practice and evaluation-support tool, not an automated hiring decision-maker.

## Key Features

- **Adaptive Interview Agent:** Generates one role-aware question at a time from saved interview state.
- **Dynamic Difficulty:** Deterministic transitions across Easy, Medium, Hard, and Expert.
- **AI Follow-ups:** A partial answer can produce one contextual follow-up; consecutive follow-ups are blocked.
- **RAG-based Answer Evaluation:** Rubric concepts and semantic retrieval support answer evaluation.
- **Multimodal Standard Interview:** Text/transcript, browser recording, and observable camera-engagement signals where browser support is available.
- **Interview Arena:** Separate practice mode with deterministic XP, streaks, one hint, levels, and a Boss Round.
- **Explainable Reports:** Shows the adaptive journey, answer-quality scores, and adaptation outcomes.
- **Real Performance History:** PostgreSQL-backed dashboard and saved interview history.

## Architecture

```mermaid
flowchart TD
  C[Candidate] --> F[React + Vite frontend]
  F --> A[FastAPI backend]
  A --> S[Adaptive state and deterministic policy]
  A --> G[Gemini generation and evaluation]
  A --> R[RAG rubric retrieval / embeddings]
  A --> P[(PostgreSQL)]
  F --> M[Browser media APIs and MediaPipe]
  S --> I{Interview mode}
  I --> ST[Standard Interview report]
  I --> AR[Interview Arena results]
```

## Interview Flows

**Standard Interview:** Login → Readiness → Question → Candidate response → Immediate evaluation → Adaptive decision → Next question or follow-up → Final report.

**Interview Arena:** Select practice topic → Adaptive challenge → Answer → AI evaluation → XP and streak → Next level → Boss Round → Arena results.

Standard Interview deliberately has no XP, levels, streaks, hints, or Boss Round. Arena state and scoring are persisted separately.

## Tech Stack

Frontend: React, Vite, Tailwind CSS, Firebase Authentication, MediaPipe.

Backend: FastAPI, Python, PostgreSQL, Google Gemini, semantic embeddings/RAG.

Media: Browser camera/microphone APIs and MediaRecorder.

## Setup

Prerequisites: Node.js/npm, Python, PostgreSQL, and a Firebase project with Email/Password authentication enabled.

```sh
npm install
npm run dev
```

For the backend, from the repository root:

```sh
python -m venv .venv
# Activate .venv using your platform's command
python -m pip install -r backend/requirements.txt
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
python -m uvicorn main:app --app-dir backend --reload --port 8000
```

Copy `.env.example` to `.env` for the frontend and `backend/.env.example` to `backend/.env` for the backend. Do not commit either real environment file.

## Environment Variables

Frontend:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Backend:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
GEMINI_API_KEY=
GEMINI_QUESTION_MODEL=gemini-flash-lite-latest
GEMINI_EVALUATION_MODEL=gemini-flash-lite-latest
```

## Database

`users` maps Firebase identities to internal UUIDs. `interviews` stores session state and mode. `interview_questions` and `interview_responses` preserve adaptive turns and evaluations. `arena_stats` and `arena_turns` store deterministic Arena progression. `evaluation_reports` stores completed Standard Interview reports.

## AI Methodology

Gemini produces role-specific questions and evaluates answers against private rubric concepts. Embeddings retrieve relevant rubric material for evaluation. The LLM does not choose game mechanics or difficulty.

| Answer quality score | Deterministic next action |
| --- | --- |
| 85–100 | Increase one difficulty level |
| 70–84 | Keep difficulty; move to a new topic |
| 50–69 | Keep level; allow one contextual follow-up when eligibility rules pass |
| 0–49 | Decrease one level and use a recovery/concept question |

Follow-up controls prevent more than one consecutive follow-up. Arena XP, streaks, hint penalty, Boss Round placement, and idempotency are deterministic backend logic.

## Responsible Interpretation and Limitations

- LLM evaluation can vary and depends on Gemini availability; deterministic fallbacks preserve session integrity.
- Camera engagement, face presence, approximate gaze direction, and head alignment are observable approximations. They do not measure confidence, honesty, personality, emotion, or employability.
- Speech Fluency currently uses transcript/filler-word signals rather than full acoustic modelling.
- Active interview refresh recovery is limited; completed Arena results can be reloaded from persisted state.
- The system supports coaching and self-practice, not hiring decisions.

## Future Work

Potential extensions include automatic speech-to-text, deeper acoustic analysis, resume-driven interviews, a skill knowledge graph, active-session recovery, coding challenges, and longitudinal analytics.

## Project Structure

```text
backend/
  main.py              API endpoints
  adaptive_service.py  adaptive state and persistence
  adaptive_questions.py fallback questions
  arena.py             deterministic Arena rules
  gemini_service.py    Gemini and embedding integration
src/
  pages/               Standard and Arena screens
  components/          reusable UI and camera engagement monitor
  services/            API and vision helpers
schema.sql             PostgreSQL schema and additive migrations
docs/                  demo, live-test, viva, and submission guides
```

See [the demo guide](docs/demo-guide.md), [live-test checklist](docs/live-test-checklist.md), and [viva questions](docs/viva-questions.md) before presenting or submitting.
