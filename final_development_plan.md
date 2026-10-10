# Final Development Plan — Strict Scoring & Live Gaze Warnings

_Date: 2026-10-10 · Based on the ChatGPT review, checked against the current code_

Two goals:

1. **Scoring must not reward skipped or non-answers.** Today, saying "skip" five times can still score about 30/100.
2. **Live candidate warning** when the candidate keeps looking away from the screen.

The architecture stays as it is. No database schema changes. The Arena scoring formula is not touched.

---

## 0. What the code review found (differences from the ChatGPT prompt)

These points come from reading the actual code. They change how parts of the ChatGPT prompt should be implemented.

| # | Finding | Where | Impact on plan |
|---|---------|-------|----------------|
| F1 | `face_absent` is **already a MAJOR violation**: a 10 s episode in `useIntegrityGuard` raises a counted warning and can end the interview. | `src/hooks/useIntegrityGuard.js` (`episodes.face_absent`), `backend/integrity.py` (`MALPRACTICE_EVENTS`) | Keep that behaviour. The new "keep your face visible" nudge is a **soft** reminder that fires *before* the 10 s major event (at about 3 s), and it is never counted. |
| F2 | `guard.warning` opens the blocking integrity modal and **pauses silence detection** (`g.isPaused()` checks `s.warning`). | `useIntegrityGuard.js` | Gaze warnings need a **separate, non-blocking state** (`attention`). Reusing `showWarning()` would interrupt answers. |
| F3 | `BehaviorMonitor` already passes every frame to `guard.handleFrame` through `onFrame`. The guard is where camera episodes and event queueing already happen. | `Interview.jsx` around line 848 | Put the gaze timer logic in a **pure helper** and drive it from `guard.handleFrame`. Do not add a second frame pipeline in BehaviorMonitor. |
| F4 | `useIntegrityGuard` is **shared with Arena** (`ArenaPlay.jsx`). | `src/pages/ArenaPlay.jsx` | Gaze warnings are **opt-in** (`gazeWarnings: true`), enabled only by `Interview.jsx`. Arena behaviour does not change. |
| F5 | `CRITERIA_WEIGHTS` and `evaluate_answer_with_rag` are shared by Standard and Arena answers. Arena XP uses `answer_quality_score`. | `gemini_service.py`, `arena.py` | Re-weighting the criteria will also change Arena answer quality and XP slightly. This can't be avoided and is acceptable: it is the same grader. Arena's **overall/XP formula** is not modified. |
| F6 | The legacy batch fallback gives **at least 40** answer quality to *any* answer, including empty ones (`max(40, …)`). | `gemini_service.batch_evaluate_interview`, Step D | Short-circuit non-answers to 0 in that path too. |
| F7 | An early-ended interview pads missing turns with zero evaluations. With the new completion multiplier, this would **penalise twice**. | `main.py` `complete_and_evaluate_interview`, Step B2 | Replace the zero-padding with the completion ratio (see §1.4). |
| F8 | The speech "delivery_score" from audio is also averaged over skipped answers. A spoken "skip" has metrics and can score high on fluency. | `main.py` Step C, `speech_analysis.summarize` | Filter speech metrics to substantive answers as well as the text fallback. |
| F9 | `scoring.insights()` would output "Correctness was your weakest criterion (0/100)", and the summary fallback outputs "Focus on reducing the 0 filler words…". `summarize_interview` (Gemini) is called even when every answer was skipped. | `scoring.py` Block 4, `main.py` Step D | Add a dedicated "insufficient responses" branch and skip the Gemini holistic summary when `answered == 0`. |
| F10 | Coding turns store `coding_result`, and their `candidate_answer` may not be prose. | `main.py` submit_code, `adaptive_service.insert_response` | A coding turn counts as answered when the submitted code is non-blank. `is_non_answer` is never applied to code. |
| F11 | Malpractice penalties (`malpractice.apply_penalty`) can zero an answer. | `malpractice.py` | A penalised answer still counts as **attempted** (it is not a skip). Its score stays penalised. |
| F12 | The frontend "Skip to answer" button only skips the TTS reading. "Select Next to skip" submits an empty answer. | `Interview.jsx` | Both are already handled by the empty/non-answer path. No UI change needed. |

---

## PART 1 — Strict interview scoring (backend)

### 1.1 Non-answer detection: `is_non_answer(text) -> bool`

**Location:** `backend/nlp_evaluator.py`. It is already a pure text module, it is imported by `scoring.py` and it can be imported by `gemini_service.py`. If importing it into `gemini_service` would create a circular import, use a new tiny `backend/answer_rules.py` instead.

```python
NON_ANSWER_PHRASES = {
    "skip", "pass", "next", "next question", "skip this", "skip this question",
    "i don't know", "i dont know", "don't know", "dont know", "idk",
    "no idea", "no", "nothing", "no answer", "not sure", "i'm not sure", "im not sure",
}
MAX_NON_ANSWER_WORDS = 5

def normalize_answer(text) -> str:
    # lowercase, unify curly apostrophes (’ -> '), collapse whitespace,
    # strip leading/trailing punctuation such as . , ! ? … - "
    ...

def is_non_answer(text) -> bool:
    """True for empty text or a short, known non-answer phrase only."""
    norm = normalize_answer(text or "")
    if not norm:
        return True
    return len(norm.split()) <= MAX_NON_ANSWER_WORDS and norm in NON_ANSWER_PHRASES
```

Rules:
- This is an **exact match after normalisation**, not a substring match. "I don't know the exact implementation, but I would use a hash map…" returns `False`.
- Filler-only transcripts such as "um", "uh um" also count as non-answers. Strip the filler words (reuse the `nlp_evaluator` filler list) before matching; empty after stripping means non-answer.
- Pass speech transcripts through the same normaliser. STT often adds a trailing "." (for example "Skip.").

### 1.2 Per-answer evaluation (`gemini_service.py`)

1. **New criteria weights:**
   ```python
   CRITERIA_WEIGHTS = {
       "correctness": 0.50,
       "completeness": 0.20,
       "technical_depth": 0.20,
       "relevance": 0.10,
   }
   ```
   `answer_quality_from_criteria` stays as it is (weighted mean). Keep `apply_strictness` and its caps (short answer, relevance < 40, correctness < 40 → cap at correctness + 15). They already stop a wrong answer from being rescued by depth.

2. **Extend Step A of `evaluate_answer_with_rag`** from "empty" to "non-answer". Gemini is not called:
   ```python
   if nlp_evaluator.is_non_answer(candidate_answer):
       return {
           "answer_quality_score": 0, "communication_score": 0,
           "criteria_scores": {name: 0 for name in CRITERIA_WEIGHTS},
           "strengths": [], "improvements": ["Attempt an answer, even a partial one."],
           "feedback": "No substantive answer was provided for this question.",
           "missing_concepts": [], "evaluation_source": "skipped",
           "content_signals": None,
       }
   ```
   `evaluation_source = "skipped"` (truly empty input can stay `"empty"`). This value is how the backend tells skips apart later without a schema change. The column is free text, so check its length or constraint in `schema.sql` first.

3. **`adaptive_service.evaluate_and_store`:** do not embed a non-answer (treat it like the existing empty case), so no embedding API call is spent.

4. **Legacy batch path (F6):** in `batch_evaluate_interview`, build zero evaluations for non-answer items *before* both the Gemini prompt and the local fallback. Only substantive items go to the model. In the local fallback, drop the `max(40, …)` floor for non-answers.

5. **Prompt tweak (optional, low risk):** add one line to the grading prompt: "correctness dominates: a confident, detailed but wrong answer must score low overall". The weights already enforce this; the line keeps the model's scores consistent with them.

### 1.3 Component weights (`scoring.py`)

```python
WEIGHTS = {
    "answer_quality": 0.70,
    "communication": 0.15,
    "speech_fluency": 0.10,
    "camera_engagement": 0.05,
}
SCORING_VERSION = 3
```

- Keep re-normalisation for **genuinely unavailable** components: no camera model, so `camera = None`; no substantive answers, so `fluency = None`.
- Answer quality and communication are **never** `None` when the interview has turns. Skipped turns give real zeros.
- Bump `SCORING_VERSION` to 3. Old reports keep their stored scores and their `scoring.version`, so history stays valid.

### 1.4 Completion ratio and the final formula

**New pure helpers in `scoring.py`:**

```python
def is_substantive(response: dict) -> bool:
    """Answered = code submitted for coding turns, otherwise not a non-answer."""
    if response.get("coding_result"):
        return bool((response.get("candidate_answer") or "").strip())   # F10
    if response.get("evaluation_source") in ("skipped", "empty"):
        return False
    return not nlp_evaluator.is_non_answer(response.get("candidate_answer"))

def completion(responses, max_turns) -> dict:
    total = max(1, int(max_turns or len(responses) or 1))
    answered = min(total, sum(1 for r in responses if is_substantive(r)))
    return {"answered": answered, "total": total,
            "skipped": total - answered,
            "ratio": answered / total,
            "rate_percent": round(100 * answered / total)}

def final_score(weighted: int, completion: dict) -> int:
    if completion["answered"] == 0:
        return 0                                   # hard rule (§E)
    return _clamp_percent(weighted * completion["ratio"])
```

**Decision: what the component averages mean.** The ChatGPT example ("weighted 80 × 0.40 = 32") only works if the components measure performance *on the answered questions*. If skipped zeros are averaged in **and** the ratio is applied, a 2/5 interview would be penalised twice (80 → 32 → about 13). So:

- `answer_quality`, `communication` and `criteria` are averaged over **substantive answers only**. They show how good the attempted answers were.
- **If `answered == 0`:** `answer_quality = 0`, `communication = 0`, `criteria = all zeros` (shown as 0, not hidden).
- The completion ratio is applied **once**, to the weighted score.
- Malpractice-penalised answers (F11) are substantive, so their 0 or capped scores stay inside the average.

**Final formula:**

```
AQ_i    = 0.50·correctness + 0.20·completeness + 0.20·technical_depth + 0.10·relevance
          (then apply_strictness caps; 0 for a non-answer)

AQ      = mean(AQ_i over substantive answers)          (0 if none)
COMM    = mean(comm_i over substantive answers)        (0 if none)
FLUENCY = see §1.5                                     (None if no substantive answers)
CAMERA  = existing camera_engagement                   (None if no data)

weighted = Σ w_k·C_k / Σ w_k   over available components
           w = {AQ: .70, COMM: .15, FLUENCY: .10, CAMERA: .05}

ratio    = answered / max_turns
overall  = 0                        if answered == 0
         = clamp(round(weighted × ratio), 0, 100)   otherwise

then the existing integrity verdict: invalid → 0
```

**Changes in `main.py` `complete_and_evaluate_interview`:**
- Compute `comp = scoring.completion(responses, interview["max_turns"])` right after the responses are loaded (after the ended-early filtering).
- **Remove the zero-padding for `ended_early` (F7).** Missing turns are already counted as unanswered through `max_turns`.
- Filter `evaluations` to the substantive ones before `average_score` / `average_criteria`. Keep the `neutral` default only for a legacy evaluation that truly lacks a score.
- `weighted = scoring.overall_score(...)`, then `overall = scoring.final_score(weighted, comp)`.
- Store `score_before_integrity = overall` as today. Also add `weighted_before_completion = weighted` to the JSON stored in `scoring_weights` (an existing JSON column, so no schema change):
  `{"weights": {...}, "completion": comp, "weighted_before_completion": weighted}`.
  Alternatively, keep `scoring_weights` as pure weights and put `completion` in the response only. Decide while implementing; either way, `completion_response` must always return a `completion` key.

### 1.5 Speech fluency for skipped answers (F8)

- **Text fallback:** `scoring.speech_fluency(fillers, count)` uses fillers and the count of **substantive, non-coding** answers only.
- **Audio path:** `speech_analysis.summarize([...])` receives `speech_metrics` from substantive answers only.
- **Zero substantive answers:** `fluency = None`. The component drops out of the weights and is shown as "—". No neutral 95.
- Change `speech_fluency(0, 0)` so that zero answers return `None`, and update the existing test (`test_speech_fluency_is_normalised_per_answer`: `speech_fluency(0, 0) == 95` becomes `None`). Keep the text-fallback formula `95 − 2 × fillers per answer` for real answers.

### 1.6 Report content and API

**`completion_response(report)`** adds:
```json
"completion": {"answered": 0, "total": 5, "skipped": 5, "ratio": 0.0, "rate_percent": 0},
"insufficient_responses": true
```
- For reports saved before v3, derive `completion` on read inside `get_interview_report`. That function already loads `turns` through `adaptive_service.report_turns`; apply `scoring.completion(turns, interview.max_turns)`. Do not change their stored overall score.
- `scores` list: when `fluency is None`, still send `{"label": "Speech Fluency", "value": null}` so the UI can show "—". The current code filters out `None` values; change it to keep Speech Fluency with `null` *only* when `insufficient_responses` is true, so older behaviour is unchanged otherwise.

**Feedback when `answered == 0`:**
- `summary_feedback = "Insufficient substantive responses were provided to evaluate interview performance. All N questions were skipped or left unanswered."` Then add the camera sentence ("Camera engagement was 87%.").
- Do **not** call `gemini_service.summarize_interview` (F9).
- Do **not** call `scoring.insights()` criteria or filler text. Use `strengths = []` (or camera-only strengths) and `improvements = ["Attempt every question; partial answers earn credit, skipped ones do not."]`.
- Remove the "Focus on reducing the 0 filler words" sentence everywhere: only mention fillers when `total_fillers > 0` and there are substantive answers.

**When `0 < answered < total`:** add one sentence to the summary: "You answered X of Y questions; the overall score is scaled by your 60% completion rate."

**Arena:** `complete_and_evaluate_interview` already rejects `game` mode, and Arena uses `arena_results`. No Arena formula change.

### 1.7 Frontend report (`src/pages/Report.jsx`, `src/pages/Reports.jsx`)

- Add a small **Completion** block next to the score bars (reuse the existing `Figure` component):
  - Questions answered `X / Y`
  - Questions skipped `Y − X`
  - Completion rate `Z%`
- When `insufficient_responses` is true, show `<Notice tone="warn">Insufficient substantive responses were provided to evaluate interview performance.</Notice>` above the scores.
- `scoreList`: show a `null` Speech Fluency as "—" instead of hiding it (`ProgressBar` with value `null` → text "—", no bar).
- Hide the `CriteriaPanel` when `answered == 0`; the zeros carry no information.
- `Reports.jsx` (history list): optionally show "Answered X/Y" in each row when present. Old reports without `completion` render as before.
- Per-turn cards: a turn with `evaluation_source === "skipped"` shows a "Skipped" badge instead of criteria chips.

---

## PART 2 — Live "look at the screen" warnings (frontend)

### 2.1 Pure helper: `createAttentionTracker` (in `src/services/malpracticeSignals.js`)

It sits next to `createEpisode` and follows the same style. Time is passed in, so tests need no fake timers.

```js
export const LOOK_AWAY_WARNING_MS = 3000;
export const FACE_MISSING_WARNING_MS = 3000;   // the major face_absent still fires at 10 s
export const GAZE_WARNING_COOLDOWN_MS = 6000;
export const GAZE_WARNING_DISPLAY_MS = 4000;

// update(t, observation) -> { warn: 'look_at_screen' | 'show_face' | null,
//                             clear: boolean, episodeStart: boolean }
export function createAttentionTracker({
  lookAwayMs = LOOK_AWAY_WARNING_MS,
  faceMissingMs = FACE_MISSING_WARNING_MS,
  cooldownMs = GAZE_WARNING_COOLDOWN_MS,
} = {}) { ... }
```

Logic per frame:
- `away = facePresent && !(eyeContact && headCentered)`. Use both MediaPipe signals already in the `observation` (`eyeContact`, `headCentered`). Optionally accept either one ("eyeContact || headCentered") if testing shows too many false positives. Keep this choice in one line.
- `missing = !facePresent`.
- Keep a `since` timestamp per condition. It **resets** as soon as the condition stops being true (the gaze returns).
- When a condition has lasted ≥ threshold **and** `t − lastWarnAt ≥ cooldownMs`: return `warn`, set `lastWarnAt = t`.
- **Episodes:** one continuous away period is one episode. `episodeStart` is true only on the first warning of an episode, so only one integrity event is logged per episode, however long it lasts. A new episode starts only after attention has returned (the condition was false).
- `clear: true` on the first frame after attention returns, so the banner can hide at once.

### 2.2 Wiring in `useIntegrityGuard.js` (F2, F3, F4)

- New hook option `gazeWarnings = false`. `Interview.jsx` passes `true`; `ArenaPlay.jsx` does not change.
- New state `attention` (`null | { kind, message, at }`) and a ref holding the tracker.
- In `g.handleFrame`, after the existing episodes, when `gazeWarnings` is on:
  ```js
  const a = s.attention.update(time, observation);
  if (a.warn) g.showAttention(a.warn);
  else if (a.clear) g.clearAttention();
  if (a.episodeStart && a.warn === 'look_at_screen')
    g.queueEvent({ id: newEventId('looking_away'), type: 'looking_away', ...g.context() });
  ```
- `showAttention` sets the state and starts a `GAZE_WARNING_DISPLAY_MS` auto-hide timer. `clearAttention` hides it.
- **Never** call `registerViolation`, `showWarning` or touch `s.violations` / `s.warning`. So it is not counted, there's no modal, silence detection doesn't pause and the interview can't be terminated.
- For "show_face", no extra event is logged. The existing major `face_absent` episode at 10 s already records it.
- Reset the tracker on `g.newAnswer()` and when `watching` stops. No warnings before `g.start()` or after termination (this is already guarded by `s.watching`).
- Return `attention` from the hook.

### 2.3 UI in `Interview.jsx`

- During the interview stage, render the banner **above the answer area** (main column), not inside the Camera Engagement card:
  ```jsx
  {guard.attention && (
    <Notice tone="warn" role="alert" className="mb-3">
      {guard.attention.kind === 'show_face'
        ? 'Please keep your face visible to the camera.'
        : 'Please look toward the interview screen.'}
    </Notice>
  )}
  ```
  Use the existing `Notice` component; no new design. `role="alert"` makes screen readers announce it.
- Hide it when the major-violation modal (`guard.warning`) or the away screen is showing, so it never stacks on top of them.

### 2.4 Backend: the minor `looking_away` event (`backend/integrity.py`)

- Add `"looking_away"` to `MINOR_EVENTS` (it is then automatically part of `CLIENT_EVENT_TYPES`, so the events endpoint accepts it).
- `LABELS["looking_away"] = "Looked away from the interview screen"`.
- `summarize()`: add `"gaze_warnings": counts.get("looking_away", 0)`. It is **not** in `violations`.
- **Level decision:** the current rule makes any minor event set `level = "minor"`. Because gaze estimation is approximate, **exclude `looking_away` from the `minor` count** used for the level. Otherwise one glance episode turns a clean interview into "minor". Report it on its own instead.
- `malpractice.verdict` doesn't change. The existing `reading_pattern` signal stays the only gaze-based malpractice input.
- Rate limit: the events endpoint should already de-duplicate by event id. The frontend cooldown and episode logic keep the volume to a handful per interview.

### 2.5 Report

- `Report.jsx` integrity section: add `<Figure label="Gaze warnings" value={`${integrity.gaze_warnings ?? 0}×`} />`. Do **not** add `looking_away` to the `MINOR_EVENTS` "blocked actions" count, because it is not a blocked action.
- The event timeline already labels events through `integrity.LABELS` and `major: false`, so `looking_away` shows up as a minor entry automatically.

---

## PART 3 — Protecting existing behaviour

| Area | Why it stays safe |
|------|-------------------|
| Adaptive flow / follow-ups / difficulty | `adaptive.py` reads `answer_quality_score`. Skips now give exactly 0 (before, a skip could get 0 from Gemini anyway), so difficulty steps down as intended. Check `test_adaptive.py`. |
| Voice & typed interviews | `is_non_answer` normalises transcripts and typed text the same way. |
| Recording, transcription | Untouched. |
| Gemini + RAG evaluation | Same pipeline; only obvious non-answers short-circuit. |
| Arena | Overall/XP formula untouched. Only the shared criteria weights change (F5). Gaze warnings are off for Arena (F4). |
| Fullscreen / tab / window proctoring and early termination | No change to `proctoring.js`, `onLeave` or `registerViolation`. `looking_away` is minor. |
| Major `face_absent` (10 s) | Unchanged. The soft nudge fires earlier and is only advisory. |
| Report history / DB | No schema change. v1/v2 reports render as before; `completion` is derived on read. |

---

## PART 4 — Tests

### Backend (`pytest`, in `backend/test_scoring.py` and `backend/test_integrity.py`, plus a small `test_answer_rules.py` if a new module is created)

1. All 5 answers "skip" → each evaluation is 0/0 with source `skipped`, Gemini is **not** called (patch `get_client`, assert no call), report AQ = 0, COMM = 0, overall = 0.
2. All answers empty → overall = 0, fluency `None`.
3. 2 of 5 substantive (AQ 80 etc., weighted 80) → overall 32; `completion = {answered: 2, total: 5, skipped: 3, rate_percent: 40}`.
4. 5/5 answered → overall equals the weighted score (no penalty).
5. `scoring.WEIGHTS == {aq .70, comm .15, fluency .10, camera .05}`; `overall_score(100, 0, 0, 0) == 70`; the re-normalisation test is updated: `overall_score(90, 70, None, 80)` = (63 + 10.5 + 8) / 0.95 → 86.
6. `gemini_service.CRITERIA_WEIGHTS` values; `answer_quality_from_criteria({100, 0, 0, 0}) == 50`.
7. `is_non_answer` is True for "skip", "Skip.", " I don't know ", "I dont know!", "idk", "next question", "", "um uh".
8. `is_non_answer("I don't know the exact method, but I would solve it using a hash map…")` is False, and so are "no, because…" and "pass by reference means…".
9. All skipped with camera = 100 and vision metrics full → overall = 0.
10. Ended early after 2 answered of 5 → no zero-padding; overall = weighted × 0.4 (regression test for F7).
11. Coding turn with code and `coding_result` counts as answered; blank code does not.
12. Malpractice-zeroed answer counts as answered and its 0 stays in the AQ average.
13. Insufficient-responses summary: no "0 filler words" text; `summarize_interview` not called; `completion_response` includes `completion` and `insufficient_responses`.
14. Legacy batch fallback: an empty answer gets 0, not 40 (F6).
15. `integrity.summarize` with 3 `looking_away` events: `violations == 0`, `gaze_warnings == 3`, `level == "clean"`; `looking_away` is in `MINOR_EVENTS` and `CLIENT_EVENT_TYPES` and not in `MAJOR_EVENTS`.
16. Update the existing assertions that encode the old values: `test_overall_score_drops_missing_camera_weight` and `speech_fluency(0, 0) == 95`.

### Frontend (`vitest`)

`src/services/malpracticeSignals.test.js` (pure tracker, synthetic timestamps):
17. Away for 2.9 s, then back → no warning.
18. Away continuously ≥ 3 s → `warn: 'look_at_screen'`.
19. Away 2 s, back 0.5 s, away 2 s → no warning (the timer reset).
20. Away for 60 s at 10 fps → at most `ceil(60 / 6) = 10` warnings and **exactly 1** `episodeStart`.
21. Face missing ≥ 3 s → `warn: 'show_face'`.

`src/pages/Interview.test.jsx` (uses the existing BehaviorMonitor mock and `onFrame` driving):
22. Sustained away frames → the text "Please look toward the interview screen." is visible.
23. Gaze warnings do **not** change "Integrity warnings 0 of 3", do not open the integrity modal, and do not call `onTerminate`. Exactly one `looking_away` event reaches `api.reportProctoringEvents`.
24. Existing fullscreen/tab/window tests (`proctoring.test.js`, current `Interview.test.jsx`, `ArenaPlay.test.jsx`) pass unchanged. ArenaPlay shows no gaze banner.

`src/pages/Report.test.jsx`:
25. A report with `completion {0, 5}` shows "0 / 5", the insufficient-responses notice and Speech Fluency "—", and still shows Camera Engagement.

### Run

```bash
# backend (from backend/, with the venv active)
python -m pytest -q
# frontend (repo root)
npm test
```
Report the real output. Don't claim a pass without running the tests.

---

## PART 5 — Implementation order

1. `nlp_evaluator.is_non_answer` + tests (7, 8).
2. `gemini_service`: criteria weights, non-answer short-circuit, batch fallback fix + tests (1, 6, 14).
3. `scoring.py`: weights, `completion`, `final_score`, fluency `None` + tests (2–5, 9, 11, 16).
4. `main.py` complete endpoint: substantive filtering, remove padding, completion, summaries, response contract + tests (10, 12, 13). Then `get_interview_report` derives completion for old reports.
5. `integrity.py`: `looking_away` minor event + test (15).
6. `malpracticeSignals.createAttentionTracker` + tests (17–21).
7. `useIntegrityGuard` opt-in wiring + `Interview.jsx` banner + tests (22–24).
8. `Report.jsx` / `Reports.jsx` completion display + test (25).
9. Run both full suites; manual smoke test: one all-skip voice interview, one 2/5 typed interview, one look-away session.

## PART 6 — Final report checklist (after implementation)

1. Files changed
2. Exact scoring formula used
3. How skips/non-answers are detected
4. How the completion ratio is calculated
5. How the gaze warning timing works
6. Whether gaze warnings are logged to integrity history (yes: minor `looking_away`, one per episode, not counted)
7. Tests added/updated
8. Test results (real output)
9. Behaviour intentionally left unchanged (Arena formula, major `face_absent`, proctoring limits, stored v1/v2 reports)

## Open decisions to confirm before coding

- **Component averages over answered questions only** (recommended above, matches ChatGPT's 80 → 32 example) vs. over all turns. The second option penalises twice.
- **Gaze condition:** `eyeContact && headCentered` (stricter, more warnings) vs. either one (fewer false positives). Start strict, then tune with a real webcam.
- Whether `looking_away` should ever raise the integrity level to "minor" (recommended: no).
