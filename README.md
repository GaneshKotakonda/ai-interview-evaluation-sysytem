# IntervueAI — Adaptive Multimodal AI Interview Coach

IntervueAI is an interview-coaching platform that evaluates each response before choosing the next challenge. It provides a professional Standard Interview and a separate gamified Interview Arena. It is a practice and evaluation-support tool, not an automated hiring decision-maker.

## Key Features

- **Adaptive Interview Agent:** Generates one role-aware question at a time from saved interview state.
- **Dynamic Difficulty:** Deterministic transitions across Easy, Medium, Hard, and Expert.
- **AI Follow-ups:** A partial answer can produce one contextual follow-up; consecutive follow-ups are blocked.
- **Voice Interview:** One click starts the interview. Questions are read aloud by an open-source neural voice ([Piper](https://github.com/OHF-Voice/piper1-gpl)); the candidate answers out loud; the interview moves on after Next or a natural pause; the whole session is recorded. Scores stay hidden until the final report. A typed mode remains for accessibility.
- **Proctoring:** The interview runs in fullscreen. Leaving it (another tab, window or app) shows a blocking warning and is recorded with its duration; copy, paste, right-click and inspection shortcuts are blocked; a second display is flagged; camera signals add extra-face and out-of-frame events. After the configured number of violations (default 5) the interview ends and unanswered questions score 0. The report has an Integrity section with a timeline linked to the recording.
- **Speech-to-Text:** Answers are transcribed on the server with open-source [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), primed with the question for technical vocabulary and filtered for silence hallucinations.
- **Multi-criteria Evaluation:** Gemini + RAG score correctness, completeness, technical depth and relevance; answer quality is their documented weighted mean.
- **Speech Delivery:** Pace (words per minute), filler words per minute and long pauses measured from Whisper word timestamps.
- **Camera Engagement per Answer:** MediaPipe face presence, screen gaze and head alignment, blended into one score and recorded for every answer.
- **Explainable Scoring v2:** The report shows each component, the four criteria, delivery and camera summaries, and the exact weights used.
- **Answer Playback & Resume:** Owners can replay recordings from the report; a reload mid-interview resumes where it stopped.
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
  A --> W[faster-whisper speech-to-text]
  A --> T[Piper text-to-speech]
  A --> R[RAG rubric retrieval / embeddings]
  A --> P[(PostgreSQL)]
  F --> M[Browser media APIs and MediaPipe]
  S --> I{Interview mode}
  I --> ST[Standard Interview report]
  I --> AR[Interview Arena results]
```

## Interview Flows

**Standard Interview:** Login → Readiness (camera, mic level, room noise, speaker test, answer mode) → Start Interview → for each turn: question spoken aloud → candidate answers → Next or pause → speech-to-text → silent multi-criteria grading + delivery + camera metrics → adaptive next question … → holistic whole-interview evaluation → scoring v2 → final report with the interview recording → history. Each answer is graded as the interview runs (so questions can adapt), but nothing is shown until the end.

**Interview Arena:** Select practice topic → Adaptive challenge → Answer → AI evaluation → XP and streak → Next level → Boss Round → Arena results.

Standard Interview deliberately has no XP, levels, streaks, hints, or Boss Round. Arena state and scoring are persisted separately.

## Tech Stack

Frontend: React, Vite, Tailwind CSS, Firebase Authentication, MediaPipe.

Backend: FastAPI, Python, PostgreSQL, Google Gemini, semantic embeddings/RAG, faster-whisper (speech-to-text), Piper (text-to-speech).

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
.venv/Scripts/python -m pip install -r backend/requirements.txt      # Windows (macOS/Linux: .venv/bin/python)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
.venv/Scripts/python -m uvicorn main:app --app-dir backend --reload --port 8000
```

Always run the backend with the project's virtual environment. A system Python without these packages fails with `No module named 'google'`. The first start downloads the Whisper model (`base.en`, about 145 MB) and the Piper voice (`en_US-lessac-medium`, about 63 MB) into `backend/voices/` (git-ignored).

Copy `.env.example` to `.env` for the frontend and `backend/.env.example` to `backend/.env` for the backend. Do not commit either real environment file.

Check the running API at `http://localhost:8000/api/health`; it reports whether PostgreSQL is reachable, whether a Gemini key is configured and whether the speech-to-text model is loaded.

For production hosting see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Firebase Hosting + one Docker Compose server).

### Tests

```sh
npm test                                   # frontend (Vitest)
python -m pytest backend                   # backend unit and API tests
```

## Environment Variables

Frontend:

```env
VITE_API_BASE_URL=http://localhost:8000
# Optional: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
# VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID
```

Backend:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
GEMINI_API_KEY=
GEMINI_QUESTION_MODEL=gemini-flash-lite-latest
GEMINI_EVALUATION_MODEL=gemini-flash-lite-latest
# Optional, defaults shown
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=768
GEMINI_TIMEOUT_SECONDS=60
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
MAX_UPLOAD_MB=200
# Firebase project whose sign-in tokens the API accepts (match VITE_FIREBASE_PROJECT_ID)
FIREBASE_PROJECT_ID=ai-evaluation-40c8a
# Speech-to-text: whisper (default) | gemini | off; model base.en or small.en
STT_PROVIDER=whisper
STT_MODEL=base.en
# Spoken questions: piper (default) | off (browser voice fallback)
TTS_PROVIDER=piper
PIPER_VOICE=en_US-lessac-medium
```

## Database

`users` maps Firebase identities to internal UUIDs. `interviews` stores session state and mode. `interview_questions` and `interview_responses` preserve adaptive turns and evaluations (including criteria, transcript, delivery and per-answer camera metrics). `answer_transcripts` holds the speech-to-text result for a turn until the answer is submitted. `arena_stats` and `arena_turns` store deterministic Arena progression. `evaluation_reports` stores completed Standard Interview reports.

## AI Methodology

Gemini produces role-specific questions and evaluates answers against private rubric concepts. Embeddings retrieve relevant rubric material for evaluation. The LLM does not choose game mechanics or difficulty.

**Answer quality** = 0.35 × correctness + 0.25 × completeness + 0.25 × technical depth + 0.15 × relevance.

**Overall score (v2)** = 0.40 × answer quality + 0.25 × communication + 0.20 × camera engagement + 0.15 × speech delivery. A component without data is dropped and the rest re-weighted; the weights used are saved with every report.

**Speech delivery** starts at 100 and loses points for pace outside 110–160 words per minute, more than one filler word per minute, and pauses over 1.5 s. Typed answers fall back to a filler count from the text.

**Camera engagement** = 0.5 × screen gaze + 0.3 × face presence + 0.2 × head alignment, per answer, averaged over the interview.

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
- Speech delivery uses timing from the transcript (pace, fillers, pauses), not pitch or tone. Whisper sometimes drops filler words, so filler counts are a lower bound.
- When the camera model produces no data, Camera Engagement is omitted and the overall score is re-weighted over the other components; no value is assumed.
- Every API call except `/api/health` must carry the signed-in user's Firebase ID token (`Authorization: Bearer …`); the backend verifies it against Google's signing certificates and only lets users read or change their own interviews and account. Uploaded answer videos are stored on the server's disk and are not served over HTTP.
- A reload resumes an active Standard interview (the recording continues as a new part); an Arena game in progress cannot be resumed (its results reload once finished).
- Proctoring detects leaving the interview window, not applications running in the background or a second device such as a phone; a web page cannot see those. Integrity is reported beside the score, not mixed into it. Operating-system lockdown (Safe Exam Browser) is planned for version 2.
- Voice mode needs a reasonably quiet room: background conversation can be transcribed as part of an answer. Readiness measures room noise and the report flags answers that look unrelated to the question.
- Piper is GPL-3.0 licensed; running it on our own server is fine, but redistributing a modified Piper would require sharing that source.
- The system supports coaching and self-practice, not hiring decisions.

## Future Work

**Version 2:** a coding round with VPL (Virtual Programming Lab): in-browser editor, sandboxed execution and test-case grading, with Safe Exam Browser lockdown. Other extensions include acoustic (tone/pitch) analysis, resume-driven interviews, a skill knowledge graph, Arena session recovery, coding challenges, and GPU-accelerated transcription for larger deployments.

## Project Structure

```text
backend/
  main.py              API endpoints and transaction handling
  config.py            environment settings (loaded once)
  auth.py              Firebase ID-token verification
  adaptive.py          deterministic difficulty and follow-up policy
  adaptive_service.py  adaptive state and persistence
  adaptive_questions.py question validation and offline fallback questions
  arena.py             deterministic Arena rules
  scoring.py           final-report scoring rules
  nlp_evaluator.py     filler words and rubric retrieval
  stt_service.py       speech-to-text (faster-whisper, Gemini fallback)
  tts_service.py       spoken questions (Piper neural voice, cached)
  integrity.py         proctoring event rules and integrity summary
  speech_analysis.py   pace, filler and pause metrics
  gemini_service.py    Gemini and embedding integration
  database.py          PostgreSQL connections
src/
  pages/               Standard and Arena screens
  components/          reusable UI and camera engagement monitor
  services/            API and vision helpers
  utils/               shared storage keys and journey helpers
schema.sql             PostgreSQL schema and additive migrations
docs/                  demo, live-test, viva, submission, development and deployment guides
deploy/                Dockerfile, docker-compose.yml and Caddyfile for production
firebase.json          Firebase Hosting configuration for the frontend
```

See [the demo guide](docs/demo-guide.md), [live-test checklist](docs/live-test-checklist.md), and [viva questions](docs/viva-questions.md) before presenting or submitting.
