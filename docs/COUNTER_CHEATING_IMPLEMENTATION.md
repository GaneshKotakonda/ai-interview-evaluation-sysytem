# Counter-Cheating Interviewer — Implementation Report

Implemented in the existing `Shafreed` worktree on 2026-10-13, following the approved [design](superpowers/specs/2026-10-13-counter-cheating-interviewer-design.md) and [implementation plan](superpowers/plans/2026-10-13-counter-cheating-interviewer.md). Changes remain local and uncommitted. The feature participates in Standard Interviews and replaces a scheduled turn.

The [feature guide](COUNTER_CHEATING.md) contains the architecture diagram, configuration, API contracts, migration commands and professor demo.

## A. Files created

| Area | Files |
| --- | --- |
| Backend | `backend/counter_cheating.py`, `backend/verification_questions.py`, `backend/verification_report.py` |
| Backend tests | `backend/test_counter_cheating.py`, `backend/test_verification_questions.py`, `backend/test_assessment_boundaries.py`, `backend/test_counter_cheating_flow.py`, `backend/test_verification_report.py` |
| Frontend | `src/components/KnowledgeVerificationReport.jsx` |
| Frontend tests | `src/hooks/useIntegrityGuard.test.jsx`, `src/services/sceneMonitor.test.js` |
| Documentation | `docs/COUNTER_CHEATING.md`, `docs/COUNTER_CHEATING_IMPLEMENTATION.md`, `docs/superpowers/specs/2026-10-13-counter-cheating-interviewer-design.md`, `docs/superpowers/plans/2026-10-13-counter-cheating-interviewer.md` |

## B. Files modified

| Area | Files |
| --- | --- |
| Backend | `backend/assessment.py`, `backend/adaptive_service.py`, `backend/gemini_service.py`, `backend/config.py`, `backend/main.py`, `backend/arena.py` |
| Schema/configuration | `schema.sql`, `backend/.env.example`, `deploy/.env.example`, `deploy/local/.env.example`, `deploy/docker-compose.yml`, `deploy/local/docker-compose.yml` |
| Frontend | `src/hooks/useIntegrityGuard.js`, `src/services/api.js`, `src/pages/Interview.jsx`, `src/pages/Report.jsx` |
| Existing frontend tests | `src/services/api.test.js`, `src/pages/Interview.test.jsx`, `src/pages/Report.test.jsx` |
| Run/deployment guides | `commands.md`, `docs/LOCAL_SETUP.md`, `docs/DEPLOYMENT.md` |

Existing answer grading, adaptive difficulty, authentication/ownership, monitoring models, identity rules, integrity penalties, recording and Arena progression are preserved. The Arena modification explicitly preserves its original event-attribution behavior when using the shared assessment helper.

## C. Database migration changes

All additions in [schema.sql](../schema.sql) are rerunnable:

| Addition | Purpose |
| --- | --- |
| `interview_questions.verification_meta JSONB` | Parent response/index, `policy_version`, historical risk decision, consumed evidence, target/type, issuance timestamp |
| `interview_responses.verification_result JSONB` | Normal raw grade, status, target, parent question and evaluation time |
| `interview_responses.submitted_at TIMESTAMPTZ` | Server submission timestamp captured before expensive grading |
| `interview_responses.observation_start_seconds FLOAT` | Nonnegative question/TTS preparation boundary, separate from the answer playback start |
| Partial unique expression index | At most one verification question per interview/parent response ID |

The existing private `integrity` JSON stores the versioned parent decision, including final-turn, challenge-limit and cooldown suppression. Completion retains that historical decision when recomputing penalties.

The complete schema was applied twice per PostgreSQL acceptance test against a separate disposable database. The application's database and Docker volumes were not changed. To apply it to an existing local deployment, run from `deploy/local`:

```sh
docker compose exec -T db psql -U interview -d interviews -v ON_ERROR_STOP=1 < ../../schema.sql
docker compose up -d --build
```

Start the existing `db` service first if it is stopped. No volume deletion is needed.

## D. New request flow

1. Existing browser detectors record observations with stable event IDs, question index and recording coordinates.
2. The frontend closes the answer's attribution and captures one immutable recording cutoff before transcription/submission. The server captures `submitted_at` before grading. Grading uses the existing pipeline.
3. A serialized event queue drains batches of up to 50. Before `/next-question`, the required barrier waits for successful delivery, including an already running batch. Failures retain the queue and accepted response ID for retry.
4. The existing locked `advance()` transaction first returns any cached `next_result`. Otherwise, shared assessment and strict attribution feed the deterministic Challenge Engine.
5. An eligible decision generates one targeted verification question with a dedicated validated prompt or deterministic fallback. Question, private metadata, turn advancement and cached public result commit together. A rollback consumes no evidence.
6. The candidate sees the ordinary “AI Follow-up” label, with no verification wording; “Knowledge Verification” appears only in the report. Normal TTS, recording and spoken/typed answer handling remain active. The question uses the difficulty selected by existing adaptation.
7. The accepted verification answer is graded normally. Its raw score becomes a stored result: passed at 70+, partial at 50–69, failed below 50.
8. Completion stores verification aggregates, challenge details and the combined evidence timeline. Completion/replay and saved reports expose the same aggregates, with older reports normalized to zero counts.

The report's main chain is **Integrity evidence → Verification requested → Concept tested → Verification result**. Existing verdicts, penalties, identity evidence and authenticated playback remain visible.

## E. Exact risk and trigger rules

Policy version: **`counter_cheating_v1`**. Defaults: enabled, threshold 60, maximum two challenges.

| Eligible evidence | Family | Contribution |
| --- | --- | ---: |
| Confirmed stored phone/extra-person episode | scene | 70 |
| Existing assessment or stored other voice | audio | 70 |
| Existing assessment or stored injected text | typing | 70 |
| Stored tab/window/fullscreen departure | browser | 35 |
| Each contributing gaze/speech/content family in existing medium/high reading assessment | Corresponding family | 30 |
| Raw score ≥85 and ≥30 above the mean of up to three comparable preceding substantive ordinary answers | performance | 15 |
| Existing long-latency/fluent-answer evidence | performance | 10 |

Use the maximum contribution within each family; cap total risk at 100. Risk bands are low 0–29, moderate 30–59 and high 60–100. A qualifying high reading assessment with at least two gaze/speech/content families raises risk to at least 70 and is a high-confidence trigger.

Issue for a direct assistance/high-reading trigger, or for risk at the effective threshold with at least two substantive non-performance families. A browser departure plus an eligible medium content family scores 65. Performance cannot supply the second behavioral family. The configurable threshold is clamped to 60–100; challenge count is clamped to 0–2. Invalid settings use safe defaults.

Compare score history only within the same modality and evaluation source; exclude empty/skipped/verification responses. Only Standard mode is eligible. Never exceed `max_turns`, issue more than two challenges, challenge the same parent twice, or reuse consumed evidence. A consecutive verification requires a new severe stored direct episode after the previous verification was generated; reading and performance cannot form a chain.

## F. Exact false-positive protections

- Gaze alone, latency alone, a score increase alone and browser departures alone never trigger. Low reading assessments and single advisory observations add no triggering reading evidence.
- Reading uses the existing helper and underlying families; no synthetic reading family is added or double-counted. Correlated observations contribute once per family.
- `face_mismatch` and `voice_mismatch` remain identity evidence and do not trigger assistance verification. Passing never clears identity or assistance penalties.
- An event must match the just-completed question and its recording part/window. The window starts at question/TTS preparation and ends at the immutable answer cutoff. Delayed delivery can count; post-answer observations cannot. Untimed events must have been stored by server submission time.
- Episode duration updates retain the original ID and cannot become a new challenge. Response-derived signals have stable identifiers.
- Challenges use neutral wording; live payloads omit risk, consumed evidence, metadata, rubric and hidden tests. Generation treats supplied text as data and rejects accusations, disclosure, near duplicates and definition/yes-no-only probes.
- Existing violation/away termination rules take priority. Issued unanswered challenges remain unanswered rather than being fabricated as failures.

Independent review findings were addressed with regression coverage: preparation observations, fallback-history exhaustion, Arena attribution and derived-evidence timeline links. Duplicate validation and fallback selection retain the full bounded interview history (up to 20 turns); only the model prompt uses the latest six.

## G. Example verification challenge

For an answer about binary search:

> For binary search over 1,024 sorted values, trace the changing search bounds and worst-case comparisons. Explain how you handle a missing target and what changes for unsorted values.

The local fallback records target `binary search bounds`. Coding fallbacks instead probe the submitted solution's execution, complexity or edge cases without copying its code or hidden tests.

## H. Tests added

- Pure policy: clean/single-family answers, every direct indicator, independent medium families, high reading, family deduplication, identity exclusion, settings, caps, consumed evidence, cooldown, comparable scores and raw result bands.
- Generation: dedicated data-only prompt, malicious/malformed/duplicate output, missing-key/network fallback, answer/rubric disclosure, coding safety, supported-claim targeting and exhausted fallback history.
- Attribution/report: preparation and answer boundaries, delayed and post-submission observations, legacy/Arena behavior, derived evidence anchors and absent metadata.
- Real PostgreSQL/API: 16 cases, including the required stored-phone scenario, real ownership and evidence queries, idempotent event storage, cached advancement, rollback, final-turn suppression/result, disabled feature, planned coding-turn replacement, coding submission without hidden-test disclosure, early unanswered completion and distinct Q2/Q10 challenges in a longer interview.
- Frontend: queue serialization, multiple batches, arrivals/duration updates during sends, failed delivery/retry, timeout and termination deadlock; verification copy/TTS and existing answer controls; visible report chain, timeline/playback and legacy rendering; actual scene-monitor episode logic with controlled detector output.

The required acceptance scenario runs **stored phone during Q2 → targeted `kind='verify'` Q3 → ordinary grading with controlled raw score 82 → persisted passed result → complete/saved report chain**. It uses real PostgreSQL and API orchestration; Gemini grading/embeddings and authentication identity are controlled test doubles. It does not establish physical camera accuracy.

## I. Test results

| Command/check | Result |
| --- | --- |
| `.venv/bin/python -m pytest backend -q`, with the disposable PostgreSQL DSN configured | **293 passed, 106 subtests passed** |
| Actual PostgreSQL acceptance file | **16 passed**; included in the full backend run |
| `npm test` | **23 test files, 171 tests passed** |
| `npm run build` | **Passed**, 1,662 modules transformed |
| `git -c core.whitespace=cr-at-eol diff --check` | **Passed**; preserves existing CRLF files |

No tests were deleted, disabled or weakened. Initial environment failures from missing CodeMirror packages and the declared `pypdf` dependency were resolved by syncing existing dependencies; package manifests/lockfiles were not changed. No unrelated baseline failures remain.

Non-blocking output: the Google SDK uses a Python typing alias scheduled for deprecation; Vite reports the existing large main bundle category (>500 kB). The produced JavaScript bundle is 1,274.14 kB (396.29 kB gzip). These warnings did not fail either suite or the build.

Full-run logs are available locally at `/tmp/counter-cheating-backend-final.log`, `/tmp/counter-cheating-frontend-final.log` and `/tmp/counter-cheating-build-final.log`.

## J. Professor demo

1. Apply the additive schema and rebuild using section C. Start a Standard interview with camera/microphone permission and an available next turn.
2. Give a substantive answer, ideally about a clear concept such as binary search. During that question/answer, hold a phone visibly in the frame for several seconds.
3. If the existing detector confirms a phone episode, submit the answer. The next scheduled turn becomes “Knowledge Verification”; answer its reasoning probe normally.
4. Complete the interview and open the report. Point to the four-step chain, raw result, retained evidence/penalties and recording playback.
5. For a repeatable software demonstration, run `backend/test_counter_cheating_flow.py` with `COUNTER_CHEATING_TEST_DATABASE_URL` pointing to a separate disposable database. The controlled Q2/Q3 example returns passed 82 without requiring a physical camera or live Gemini.

## K. Remaining limitations

Physical phone detection and live Gemini generation/grading were not demonstrated in this execution. The actual browser scene monitor's controlled-output tests verify its 0.4 phone threshold and sustained 1,500 ms confirmation logic; they do not measure sensor accuracy. A nearby phone outside the frame cannot be observed by this detector.

Browser observations are untrusted, camera/voice/reading heuristics can be noisy, model validation cannot guarantee pedagogical quality, and offline grading is approximate. Existing termination rules may end an interview before verification. Risk is a policy score, not a scientific probability. Neither a passed nor failed verification establishes or disproves cheating.

The isolated migration/acceptance run verifies PostgreSQL behavior. Docker deployment on the user's existing application database remains a separate operational step using the documented commands.
