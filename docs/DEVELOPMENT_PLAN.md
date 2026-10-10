# Development Plan — Completing the AI Interview Evaluation System

> **Status (5 October 2026): all phases below are implemented.** Speech-to-text (faster-whisper), speech delivery metrics, four-criteria grading, per-answer vision, scoring v2, owner-only playback, session resume, frontend and docs are done; deployment is described in [DEPLOYMENT.md](DEPLOYMENT.md). Verified by 90 backend tests, 79 frontend tests and an end-to-end run inside the production Docker image against real PostgreSQL and Whisper. Remaining manual step: run `docs/live-test-checklist.md` with real Firebase and Gemini credentials.
>
> **Update — voice interview:** one-click spoken interview with Piper text-to-speech, silence detection, whole-session chunked recording, hidden per-answer grading with a holistic final evaluation, and a typed accessibility mode. Verified by backend and frontend tests and an end-to-end run on the real stack (PostgreSQL, Gemini, Whisper, Piper).
>
> **Version 1.2:** built-in VPL coding round, ranked Arena with overall and category ratings, rules read aloud, 3 warnings / 5 seconds away, focus mode, improved silence detection, local setup guide (docs/LOCAL_SETUP.md).
>
> **Version 1.1:** identity verification (voice + face), malpractice detection (other people, phones, other voices, reading, injected text), per-answer penalties with a verdict, and stricter grading.
>
> **Version 1 complete:** proctoring added (fullscreen, leaving-the-interview detection, blocked copy/paste, second display, camera signals, automatic end at the violation limit, Integrity report). **Version 2:** coding round with VPL (Virtual Programming Lab) and Safe Exam Browser lockdown.
>
> Decisions taken: keep **PostgreSQL** (not Firestore); **faster-whisper** for speech-to-text with Gemini as fallback; recordings served through the **authenticated backend endpoint** (not Firebase Storage).

Snapshot: 5 October 2026 · branch `Shafreed` · commit `78f6887`
Sources: `OWNERSHIP.md` (scope per owner and the final target pipeline), `backend/requirements.txt`, `README.md`, `docs/`, and the code itself.

---

## 1. Where the project stands

### Overall: about **80% implemented**

Each owner's list in `OWNERSHIP.md` was scored item by item against the code:
done = 1, partly done = 0.5–0.7, missing = 0. The five areas carry equal weight.

| Area (owner) | Done | What is still missing |
| --- | --- | --- |
| Frontend & UI/UX (Ganesh) | **90%** | Transcript workflow (needs STT); session recovery after a page refresh; mobile and accessibility QA of the interview screen |
| Database / Storage / Security (Rohith) | **80%** | Videos are saved to local disk but cannot be played back, and there is no cloud storage; no deployment configuration; the dev machine has no `backend/.env` |
| Speech-to-Text + NLP (Shafreed) | **52%** | **No speech-to-text at all**; answers are typed. Only 2 scores instead of relevance/correctness/completeness/technical; fluency comes from typed text, not speech |
| Computer Vision (Harsha) | **87%** | Expressions, face presence, head alignment and multiple-face events are computed but never used; metrics cover the whole session, not each question |
| Scoring + Report + Integration (Himesh) | **90%** | Score cannot include real speech data yet; vision contributes eye contact only; the pipeline is broken at the speech-to-text step |

### Against the final target pipeline in `OWNERSHIP.md`

| # | Stage | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Login | ✅ Done | Firebase Auth; backend verifies ID tokens (`backend/auth.py`) |
| 2 | Dashboard | ✅ Done | `src/pages/Dashboard.jsx`, real PostgreSQL history |
| 3 | Camera/Mic check | ✅ Done | `src/pages/Readiness.jsx` |
| 4 | Interview | ✅ Done | Adaptive questions, follow-ups, difficulty (`adaptive.py`, `adaptive_service.py`) |
| 5 | Audio/Video capture | ⚠️ Partial | MediaRecorder records and uploads `.webm`, but nothing ever reads the file again (`main.py: save_answer_video`) |
| 6 | **Speech-to-Text** | ❌ **Missing** | No Whisper/STT code anywhere; the candidate types the answer |
| 7a | NLP evaluation | ⚠️ Partial | Gemini + RAG rubric grading works on typed text; 2 scores, not 4 criteria (`gemini_service.py: evaluate_answer`) |
| 7b | Computer vision | ⚠️ Partial | MediaPipe in browser (`visionAnalyzer.js`); only `eyeContact` reaches scoring (`scoring.py: camera_engagement`) |
| 8 | Final scoring | ✅ Done* | Weighted formula with re-weighting (`scoring.py`); *inputs incomplete (stages 6, 7) |
| 9 | Real AI feedback | ✅ Done | Gemini feedback with deterministic fallback; needs a real key to be "live" |
| 10 | Report | ✅ Done | `Report.jsx`: score, breakdown, adaptive journey, strengths and improvements |
| 11 | Interview history | ✅ Done | `MyInterviews.jsx`, `Reports.jsx` (trends), `Profile.jsx` |

**The one blocking gap is stage 6.** Without speech-to-text, the "audio" in the pipeline is recorded and then ignored, and every speech-based metric is really a typed-text metric. `OWNERSHIP.md` names this the priority: *"make the actual AI evaluation work."*

### Decisions the team should confirm before starting

1. **Database:** `OWNERSHIP.md` says Firestore, but the project was built on **PostgreSQL**, with schema, migrations, transactions, idempotency and tests. **Recommendation:** keep PostgreSQL and update `OWNERSHIP.md` to match. Rewriting it in Firestore adds risk and no new feature.
2. **Speech-to-text engine:** see Phase 1. **Recommendation:** `faster-whisper` on the backend (matches "Whisper" in the plan, free, runs locally, private), with Gemini audio transcription as a configurable fallback.
3. **Media storage:** Firebase Storage (as written) or an authenticated backend endpoint over the existing local files. **Recommendation:** start with the backend endpoint (no new infrastructure); move to Firebase Storage only if the app is deployed.

---

## 2. The plan

Eight phases. Phases 1–4 run in parallel after Phase 0; 5–7 depend on them; 8 closes out.
Estimates are focused working days for one person.

```
Phase 0  Setup & hygiene ............ all        (1 day)
   ├─ Phase 1  Speech-to-text ...... Shafreed    (4 days)  ← critical path
   │     └─ Phase 2  Speech delivery metrics ... Shafreed (2 days)
   ├─ Phase 3  Multi-criteria NLP ... Shafreed    (2 days)
   ├─ Phase 4  Vision integration ... Harsha      (3 days)
   └─ Phase 6  Media storage ........ Rohith      (2 days)
         Phase 5  Final scoring & report ... Himesh  (3 days, after 2–4)
         Phase 7  Frontend completion ...... Ganesh  (4 days, alongside 1–6)
Phase 8  Integration, QA, submission ... all, led by Himesh (3 days)
```

Shafreed carries the most work (Phases 1–3, about 8 days). If time is short, Himesh can take Phase 3 or Rohith can take the STT storage and schema part of Phase 1.

---

### Phase 0 — Setup and repository hygiene · all · 1 day

Goal: everyone can run the full stack locally with real services.

- [ ] Each developer creates `backend/.env` from `backend/.env.example` (`DATABASE_URL`, `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`) and applies `schema.sql`.
- [ ] Run the backend with the project venv: `.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload --port 8000` (system Python lacks the packages). Add this to the README.
- [ ] Walk through `docs/live-test-checklist.md` once with real Gemini/Firebase/PostgreSQL and record what fails.
- [ ] Repo cleanup:
  - `firebase-debug.log` is tracked although `.gitignore` lists it → `git rm --cached`.
  - Move `test_nlp_evaluator.py` from the repo root into `backend/` so `pytest backend` runs it.
  - Decide where coursework artefacts live (`tc_*.png`, `test_selenium_login.py`): a `submission/` folder or `.gitignore`.
  - `src/components/AuthShell.jsx` has a duplicated `tracking-[-0.02em]` class.
  - README calls the product "IntervueAI" while the UI says "AI Interview Evaluation System". Pick one.
- [ ] Update `OWNERSHIP.md` with the decisions above.

**Done when:** a fresh clone runs end-to-end on two machines and both test suites pass.

---

### Phase 1 — Speech-to-text · Shafreed · 4 days · CRITICAL

Goal: a spoken answer becomes an editable transcript that is then graded.

**Backend**
- [ ] Add `faster-whisper` to `requirements.txt` (bundles its own decoder; no system ffmpeg needed). Model size via env `STT_MODEL` (default `base.en`; `small` for accuracy).
- [ ] New `backend/stt_service.py`:
  - `transcribe(path) -> {text, language, duration_s, words: [{word, start, end, prob}], source}` with `word_timestamps=True`.
  - Lazy-load the model once per process; run in a thread so the event loop is not blocked.
  - Provider switch `STT_PROVIDER=whisper|gemini|off`; Gemini fallback sends the audio to `google-genai` and asks for a verbatim transcript.
  - Clear errors for empty or too-short audio and for unsupported codecs.
- [ ] New endpoint `POST /api/interviews/{id}/transcribe` (multipart `question_index`, `audio`):
  owner check (`owned_interview`), size limit, save to `uploads/<id>/q_<n>.webm`, return transcript and words. **Does not grade.** The candidate reviews first.
- [ ] Schema (additive, in `schema.sql`): `interview_responses` gains `transcript TEXT`, `transcript_source VARCHAR(20)`, `speech_metrics JSONB`. Keep `candidate_answer` as the final submitted text (the edited transcript).
- [ ] `submit-answer` accepts an optional `transcript_id`/flag so the response records that the answer came from speech.

**Frontend** (pair with Ganesh)
- [ ] Record audio separately (`audio/webm;codecs=opus`) alongside the video, so uploads are small.
- [ ] After **Stop Answer**: "Transcribing…" state → transcript fills the answer box (still editable) → candidate presses **Submit Answer**.
- [ ] Failure path: keep the recording and offer "Retry transcription" or "Type instead".

**Tests**
- [ ] Unit: `stt_service` with the model mocked; endpoint auth, ownership and size limits.
- [ ] One integration test with a short fixture `.webm` (skipped when the model is not installed).

**Done when:** speaking an answer produces a transcript in under ~10 s for a 60 s answer on a laptop CPU (`base.en`), and the graded answer is that transcript.

---

### Phase 2 — Speech delivery metrics · Shafreed · 2 days

Goal: "speech fluency" measures speech, not typing.

- [ ] From Whisper word timestamps compute per answer: words per minute, filler rate per minute (reuse `nlp_evaluator.count_filler_words`), number of long pauses (> 1.5 s), longest pause, speaking-time ratio.
- [ ] Store as `interview_responses.speech_metrics`.
- [ ] New `scoring.speech_delivery(metrics)`: documented bands (e.g. 120–160 wpm ideal; penalties for filler rate and long pauses). Fall back to the current text-only `speech_fluency` when no audio exists, and say so in the report.
- [ ] Unit tests for each band and edge case (silence, one word, very fast speech).

**Done when:** two recordings, one fluent and one hesitant, produce clearly different delivery scores with the reasons visible.

---

### Phase 3 — Multi-criteria answer evaluation · Shafreed · 2 days

Goal: the four criteria named in `OWNERSHIP.md` are scored and stored separately.

- [ ] Extend `gemini_service.evaluate_answer` to return `relevance`, `correctness`, `completeness`, `technical_depth` (0–100 each), plus the existing `communication_score`, strengths, improvements and missing concepts.
- [ ] `answer_quality_score` becomes a documented weighted mean (e.g. correctness 35, completeness 25, technical depth 25, relevance 15), so the adaptive thresholds keep working unchanged.
- [ ] Deterministic fallback: relevance from embedding similarity, completeness from rubric points covered, correctness and depth estimated and labelled `fallback`.
- [ ] Schema: `interview_responses.criteria_scores JSONB`; add it to `public_evaluation` and `report_turns`.
- [ ] Validation and clamping like the existing score keys; tests for malformed Gemini output.

**Done when:** each turn in the report shows four criterion scores, and adaptive difficulty behaves exactly as before.

---

### Phase 4 — Vision integration · Harsha · 3 days

Goal: everything the vision model measures reaches scoring and the report, per question.

- [ ] `BehaviorMonitor`: reset statistics at the start of each question and attach that question's snapshot to `submit-answer` (new form field `vision_metrics`).
- [ ] Store per response: `interview_responses.vision_metrics JSONB` (face presence, eye contact, head alignment, looking-away, multiple-face events, expression shares, frames analysed).
- [ ] Replace `scoring.camera_engagement` (currently eye contact only) with a documented blend, e.g. eye contact 50%, face presence 30%, head alignment 20%; return `None` when too few frames were analysed.
- [ ] Integrity flags, shown neutrally in the report: "another face appeared N times" and "face not visible for X% of the answer".
- [ ] Expressions are reported as descriptive time shares only, never scored and never described as emotion or confidence (keeps the README's responsible-use statement true).
- [ ] Unit tests for the pure functions in `visionAnalyzer.js` (`estimateHeadPose`, `estimateEyeContact`, `classifyExpression`, `metricsSnapshot`) using fixture landmark data.

**Done when:** the report shows camera metrics per question, and the session score uses the blended formula.

---

### Phase 5 — Final scoring and report · Himesh · 3 days (after 2–4)

Goal: one explainable score built from every module.

- [ ] Scoring v2 in `scoring.py`: answer quality (from Phase 3), communication, speech delivery (Phase 2), camera engagement (Phase 4). Keep re-weighting when a component is missing.
- [ ] Store `scoring_version` and the weights used in `evaluation_reports`, so old reports stay explainable.
- [ ] `/complete` aggregates per-response criterion, speech and vision data instead of session-level values.
- [ ] Strengths and improvements draw on all modules (for example "Pace was 185 wpm — slow down", "Completeness was the weakest criterion").
- [ ] Report page additions (with Ganesh): criterion averages, delivery metrics, per-turn transcript, per-turn camera summary, a "how this score was calculated" section listing the actual weights.
- [ ] Reports page: trend per component, not only the overall score.
- [ ] Optional: print stylesheet so a report can be saved as PDF.
- [ ] Tests: formula, re-weighting, version persistence, `/complete` replay.

**Done when:** every number on the report can be traced to a stored input and a documented weight.

---

### Phase 6 — Media storage and playback · Rohith · 2 days

Goal: recorded answers are private, playable by their owner, and cleaned up.

- [ ] `GET /api/interviews/{id}/media/{question_index}`: owner-only (token + `owned_interview`), streams the file with a correct content type and range support. The frontend fetches it with the token and plays it from a blob URL.
- [ ] Store audio and video paths separately (Phase 1 adds audio).
- [ ] Deleting an interview already removes its folder; add a retention setting (e.g. delete media after N days) as a small cleanup command.
- [ ] Optional, if deploying: switch to Firebase Storage with rules limiting `users/{uid}/**` to that user, keeping the same API shape.
- [ ] Tests: ownership, missing file, range requests.

**Done when:** the owner can replay each answer from the report and nobody else can fetch it.

---

### Phase 7 — Frontend completion · Ganesh · 4 days (alongside 1–6)

- [ ] Transcript workflow UI from Phase 1, with clear states: recording → transcribing → review → submitted.
- [ ] Report additions from Phases 3–6: criterion bars per turn, delivery metrics, transcript, playback.
- [ ] **Session recovery:** today a refresh on `/interview` starts a new session and abandons the old one. Add `GET /api/interviews/{id}/state` (with Rohith) and resume the active interview after a refresh.
- [ ] Mobile pass on the interview screen (camera rail below the answer, sticky submit).
- [ ] Accessibility: keyboard order through the interview, live-region announcements for transcription and grading, colour-contrast check.
- [ ] Tests for each new state.

**Done when:** a full interview can be completed by keyboard only and survives a page refresh mid-interview.

---

### Phase 8 — Integration, QA and submission · all, led by Himesh · 3 days

- [ ] End-to-end runs of the target pipeline with real Firebase, Gemini, Whisper and PostgreSQL, following an updated `docs/live-test-checklist.md`.
- [ ] One automated browser test (Playwright) for login → interview (mocked AI and STT) → report → history.
- [ ] Performance budget: transcription + grading per answer under ~15 s on the demo laptop; document the model size used.
- [ ] Update `README.md` (architecture diagram with STT, new endpoints, setup with venv), `docs/demo-guide.md`, `docs/viva-questions.md` (STT, criteria, scoring v2).
- [ ] Complete `docs/submission-checklist.md`.

**Done when:** the demo guide can be performed live, start to finish, without fallbacks.

---

## 3. Expected completion after each phase

| After | Overall |
| --- | --- |
| Today | ~80% |
| Phase 0 | ~81% (unblocks live testing) |
| Phases 1 + 2 | ~88% (pipeline complete end-to-end) |
| Phases 3 + 4 | ~93% |
| Phases 5 + 6 | ~97% |
| Phases 7 + 8 | 100% of `OWNERSHIP.md` scope |

## 4. Risks

| Risk | Mitigation |
| --- | --- |
| Whisper is slow on CPU | `base.en` by default, audio-only upload, show progress; Gemini fallback |
| Gemini quota or outage during the demo | Deterministic fallbacks already exist; label them in the UI; keep a recorded backup demo |
| Safari records `mp4` instead of `webm` | Accept both containers in the transcribe endpoint; test on Safari |
| Schema changes break existing data | Keep every migration additive (as `schema.sql` already does); test re-running it |
| Over-claiming from camera and expression data | Keep the observable-only language; never score expressions |
| Five people editing shared files (`main.py`, `Report.jsx`) | One PR per phase, small PRs, rebase often (as `OWNERSHIP.md` asks) |
