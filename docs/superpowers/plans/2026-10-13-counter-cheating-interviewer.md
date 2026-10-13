# Counter-Cheating Interviewer Implementation Plan

> **For agentic workers:** Use the approved spec and this plan task by task. The user explicitly authorized direct implementation after planning; no additional review pause is required. Independent engine and frontend work may run in parallel; the primary agent owns orchestration and integration.

**Goal:** Implement and verify the entire stored-evidence → targeted challenge → graded verification → final report chain in Standard Interviews.

**Architecture:** A deterministic engine runs inside the existing locked `advance()` transaction. Shared malpractice assessment supplies evidence; generation uses a dedicated validated Gemini prompt with a deterministic fallback. Candidate projections omit private decisions, and reports expose an auditable evidence chain.

**Tech Stack:** Python/FastAPI/psycopg2/PostgreSQL, existing Gemini SDK, React/Vite/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-counter-cheating-interviewer-design.md`, approved with policy versioning and strict answer boundaries.

## Global Constraints

- Preserve current adaptive difficulty, identity penalties, ownership checks, Standard max turns and Arena behavior.
- Persist `policy_version = counter_cheating_v1` on every decision and challenge metadata.
- Gaze, latency, score changes and browser departures alone never trigger.
- A delayed pre-submission event may qualify; an observation after submission must not qualify for the prior answer.
- Rerunnable additive schema changes; do not delete data or volumes.
- Use tests first for behavior changes. Run backend and frontend suites and production build before claiming completion.
- Keep work in this existing linked `Shafreed` worktree. Leave changes reviewable locally; do not push or merge.

## Review Focus

- Events delivered late or while grading: use immutable observation/answer recording boundaries plus a server submission timestamp, not the response insertion time.
- Episode duration updates and concurrent flushing: never drop newly queued entries or consume an old episode again.
- Retries and rollback: cached question remains identical and partial issuance never commits.
- Early termination or final-turn verification: keep issued/unanswered questions and accepted results in the report.
- Legacy reports and Arena: normalize missing fields and preserve existing response contracts.

## Task 1: Deterministic engine and generation

**Files:** create `backend/counter_cheating.py`, `backend/verification_questions.py`, `backend/test_counter_cheating.py`, `backend/test_verification_questions.py`; modify `backend/config.py`, `backend/gemini_service.py` and environment examples/Compose settings.

**Interfaces:** `counter_cheating.decide(response, assessed, events, recent_responses, challenges, *, interview_mode, current_turn, max_turns, question=None, settings=None) -> dict`; `verification_result(question, response) -> dict | None`; `gemini_service.generate_verification_question(**context) -> dict`. Generation context uses existing names `role_title`, `previous_question`, `candidate_answer`, `previous_topic`, `current_difficulty`, `rubric_points`, `strengths`, `missing_concepts`, `recent_history`, `previous_was_coding`.

- [x] Write/run failing tests for conservative triggers, family deduplication, policy version, limits, evidence reuse, identity exclusion, consecutive severe new episodes, final turns, comparable score history, fallback and malicious/malformed model output.
- [x] Implement approved weights: direct assistance 70; browser 35; eligible reading families 30 each; score increase 15; fluent long latency 10. Maximum per family; threshold minimum 60; high reading minimum 70 only with two substantive reading families.
- [x] Validate generation and safe fallbacks, including coding without code or hidden tests in question text.
- [x] Run focused pytest files. Expected: all pass; no network in tests.

## Task 2: Shared evidence and atomic persistence

**Files:** modify `backend/assessment.py`, `backend/adaptive_service.py`, `backend/main.py`, `schema.sql`; create `backend/verification_report.py`, `backend/test_counter_cheating_flow.py` and focused assessment/boundary tests.

**Interfaces:** `assessment.load_evidence(cur, interview_id) -> dict`; `assessment.assess_response(response, evidence) -> dict`; `assessment.events_for_response(response, evidence, strict_boundary=False) -> list[dict]`; `verification_report.build(cur, interview) -> dict` with counts/challenge details/timeline.

- [x] Write/run a failing stored-phone acceptance test at the query/persistence boundary, covering ordinary grading of the verification answer, saved result, identical retry and completed report chain.
- [x] Add `verification_meta`, `verification_result`, `submitted_at` and separate `observation_start_seconds` columns, a parent-response uniqueness index, and a server-owned immutable submission timestamp captured before expensive grading. Reuse existing recording positions for delayed observation attribution. Coding submissions gain optional sanitized recording positions.
- [x] Share evidence loading/assessment, retain old final penalty outputs, and preserve historical counter-cheating decisions when storing completion integrity.
- [x] Integrate engine after cached-result guard and normal adaptation; store risk/metadata/result transactionally. Final turns record suppression without an extra question. When no challenge is due retain existing generation path.
- [x] Add report aggregation and timeline to completion/replay/report APIs; never leak private metadata through live candidate question/state/evaluation projections.
- [x] Run focused flow, boundary, adaptive, malpractice and Arena tests. Expected: pass including rollback, late events and unchanged difficulty.

## Task 3: Delivery barrier and candidate/report UI

**Files:** modify `src/hooks/useIntegrityGuard.js`, `src/services/api.js`, `src/pages/Interview.jsx`, `src/pages/Report.jsx` and corresponding tests; create focused queue/guard tests and optionally a focused verification report component.

**Interfaces:** `guard.flushEvents({ required = false } = {}) -> Promise`; `guard.beginAnswer(index)` / `guard.endAnswer()` define observation attribution; optional `recording` in `api.submitCode`. Report data: `verification: { challenges, passed, partial, failed }`, `integrity.verification.details` and `integrity.verification.timeline`.

- [x] Write/run failing queue and UI tests for overlapping sends, event arrivals during sends, retained failures/retries, strict post-answer attribution, verification badge/TTS, metadata absence and visible evidence → request → concept → result chain.
- [x] Serialize queue sends, drain all pending batches, use bounded abortable proctoring requests, and await a required delivery barrier before advancing. Preserve event IDs and duration updates, avoid termination deadlocks, and retain accepted response IDs on failure.
- [x] Capture the recording end once when the answer closes; use that same immutable position in both spoken and coding submissions. Stop assigning the old question to observations during processing/after submission.
- [x] Render neutral verification UI using existing page styles and normal TTS/answer handling; extend report with counts, challenge chain and combined evidence timeline, normalizing absent legacy fields.
- [x] Run focused Vitest files. Expected: pass with normal spoken/coding flow intact.

## Task 4: Documentation, review and full verification

**Files:** create `docs/COUNTER_CHEATING.md`; update Docker/local setup docs and this plan's execution record.

- [x] Document exact policy/config/schema/API, Mermaid architecture, professor demo, data-preserving schema application and limitations.
- [x] Run `.venv/bin/python -m pytest backend`, `npm test`, `npm run build`. Expected: suites and build pass; identify/fix failures without deleting tests.
- [x] Run actual PostgreSQL migration twice and stored-phone integration when local database tooling permits; use isolated test data and roll back/delete only test-owned resources.
- [x] Obtain an independent code review of boundaries, private payloads, transaction/idempotency and report acceptance; fix material findings with regression tests.
- [x] Finish with the requested files/migrations/flow/rules/protections/example/tests/results/demo/limitations report. Do not conflate deterministic tests with physical phone-detection accuracy.

## Execution record

Planning complete. User approval covers this implementation plan and direct execution. Boundary refinement: response insertion happens after expensive grading, so `created_at` alone is insufficient; a server submission timestamp and immutable recording cutoff are required. Existing generic API calls have no timeout, so add an abortable bound specifically for integrity-event delivery.


Implementation and independent review completed on 2026-10-13. Review fixes preserve question/TTS preparation evidence with a separate recording boundary, retain Arena original attribution, provide timeline destinations for derived evidence and validate fallback/model questions against all bounded interview history. Added actual scene-monitor sustained-phone tests without changing the detector.

Final verification: backend 293 passed plus 106 subtests, including 16 real PostgreSQL/API cases; frontend 23 files / 171 tests passed; production build passed. The full schema was applied twice per database case in an isolated PostgreSQL instance. Existing dependencies were synchronized to fix initial environment failures; no tests or package manifests were weakened. SDK deprecation and Vite large-bundle warnings remain non-blocking. Physical camera accuracy and live Gemini quality were not demonstrated. See `docs/COUNTER_CHEATING_IMPLEMENTATION.md` for the requested A–K report.
