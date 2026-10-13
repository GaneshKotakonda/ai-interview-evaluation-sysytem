# Knowledge Verification in Standard Interviews

Knowledge Verification turns stored integrity evidence into a targeted question about the candidate's previous answer. The next scheduled Standard interview turn becomes a verification question, receives the ordinary answer-quality grade, and appears in the final report beside the evidence that prompted it.

The policy in [counter_cheating.py](../backend/counter_cheating.py) is `counter_cheating_v1`. Its risk score is a deterministic policy score, not a calibrated probability that someone cheated. Passing does not remove recorded evidence; failing does not establish cheating.

## Architecture and answer boundaries

```mermaid
flowchart TD
    B[Browser camera, audio and interview observations] --> Q[Serialized event queue]
    Q --> P[Authenticated proctoring API and stored events]
    A[Candidate closes answer] --> C[Immutable recording cutoff and server submission time]
    C --> G[Ordinary answer grading and accepted response]
    G --> F[Required event delivery barrier]
    P --> F
    F --> N[Locked next-question transaction]
    N --> S[Shared assessment and strict answer attribution]
    S --> E[Deterministic versioned decision]
    E -->|Eligible evidence and available turn| V[Validated Gemini verification or deterministic fallback]
    E -->|No challenge due or suppressed| O[Existing adaptive question flow]
    V --> D[Atomic question, metadata and cached next result]
    O --> D
    D --> I[Candidate sees neutral question and normal TTS]
    I --> R[Ordinary grade and persisted verification result]
    R --> H[Owner report: evidence, challenge, concept, result]
    P --> H
```

`beginAnswer(index)` attributes observations from the start of the question/TTS and its preparation time; `endAnswer()` closes that attribution before processing. Spoken, typed and coding submissions use the same captured immutable recording end position. Observations during grading do not acquire the closed answer's question index.

The backend captures `submitted_at` before expensive grading, rather than using the later response insertion time. A stored event must belong to the same question. With recording coordinates, its part must match and its observation offset must lie between `observation_start_seconds` and the immutable `answer_end_seconds`, inclusive. The observation start is the question/TTS start, distinct from `answer_start_seconds`, which locates the spoken answer for playback. Preparation observations before speech therefore qualify; observations after the cutoff never qualify. Older submissions without an observation start use their answer start as the lower recording bound. This permits delayed delivery of a pre-submission observation. Without usable recording coordinates, the stored event's server timestamp must be no later than `submitted_at`.

The frontend sends recording `{ part, start, end, observationStart }`; `observationStart` becomes API/storage `observation_start_seconds` in both spoken/typed form submissions and coding JSON. The existing `start`/`end` fields become `answer_start_seconds`/`answer_end_seconds` and continue locating answer playback. Legacy responses without the new submission timestamp retain their existing report attribution. Shared completion assessment receives the interview mode and preserves Arena's original attribution with `interview_mode='game'`, even when Arena responses have a submission timestamp.

Event sends are serialized and drained in batches of up to 50. An acknowledgement removes the exact sent queue entries, preserving arrivals and duration updates during the request. Stable client event IDs make server retries idempotent. `/next-question` waits for `flushEvents({ required: true })`; a failed delivery retains both queued events and the accepted response ID for retry. Proctoring fetches have a five-second abort bound. Termination does not wait on itself inside the queue drain, and the page checks termination again before advancement.

## Exact issuance policy

| Evidence | Family | Weight |
| --- | --- | ---: |
| Stored `phone_detected` or `extra_person` episode | `scene` | 70 |
| Stored/assessed `other_voice` | `audio` | 70 |
| Stored/assessed `text_injected` | `typing` | 70 |
| `tab_hidden`, `window_blur`, `fullscreen_exit` | `browser` | 35 |
| Eligible reading evidence in each of `gaze`, `speech`, `content` | Each named reading family | 30 each |
| Comparable answer-quality score increase | `performance` | 15 |
| Long latency followed by a long fluent answer | `performance` | 10 |

Each family contributes its maximum eligible weight once. Several browser events still contribute 35; a phone and another person in the same scene family contribute 70; score increase and latency together contribute 15. The total is capped at 100. Consumed stored event IDs and response-scoped derived signal IDs cannot issue another challenge, and an assessed flag does not count independently from its stored event.

A direct assistance indicator is sufficient for a challenge. High reading evidence is also sufficient only when it contains at least two substantive reading families (`gaze`, `speech`, `content`), and its fused risk is raised to at least 70. Otherwise, risk must meet the configured threshold and include at least two non-performance families. The configurable threshold applies to this multi-family path; it does not suppress the direct-indicator or qualifying high-reading path.

Reading families enter the engine only when the shared reading assessment is medium or high. Its existing assessment labels high at a reading score of at least 55 with at least two families, and medium at a score of at least 30. Latency contributes only supporting performance evidence: at least eight seconds before an answer of at least 60 words, with at most one filler per minute when speech metrics exist. The engine's stricter high-reading rule excludes latency from its two substantive reading families.

The score-increase signal requires a current raw answer-quality score of at least 85 and an increase of at least 30 points over the mean of up to three preceding comparable substantive answers. Comparison uses the same grading source and answer modality (spoken, typed or coding), excludes verification answers and skipped/empty answers, and requires finite grades from 0 to 100.

Ordinary gaze, latency alone, score changes alone, and browser departures alone never trigger. Identity mismatch remains under the existing identity policy and contributes no verification risk.

Challenges replace a scheduled turn and never exceed the Standard interview's `max_turns` (default 5, API range 1–20). Issuance is suppressed for a final turn, a previously challenged parent response, the challenge cap, and an ordinary continuation from a verification question. A consecutive verification question is allowed only for a new, unconsumed direct episode observed after the prior challenge was generated. Arena mode (`game`) keeps its existing progression. Existing identity penalties and violation/end-away termination rules retain priority.

Every recorded decision and challenge metadata object includes `policy_version`. Policy `risk_level` is `low` below 30, `moderate` from 30–59 and `high` from 60; these labels are policy bands.

## Configuration

Settings are read at backend startup; restart the API after changing them. For native local development, put them in `backend/.env`. For Docker, use the relevant `deploy/.env` or `deploy/local/.env` and the Compose environment mapping.

```env
COUNTER_CHEATING_ENABLED=true
COUNTER_CHEATING_THRESHOLD=60
COUNTER_CHEATING_MAX_CHALLENGES=2
```

| Setting | Default | Bounds and behavior |
| --- | --- | --- |
| `COUNTER_CHEATING_ENABLED` | `true` | `false` disables issuance; existing integrity detection and penalties remain active |
| `COUNTER_CHEATING_THRESHOLD` | `60` | Integer clamped to 60–100; invalid values use 60 |
| `COUNTER_CHEATING_MAX_CHALLENGES` | `2` | Integer clamped to 0–2; 0 suppresses challenges; invalid values use 2 |

The defaults for existing proctoring termination remain three violations and five seconds away. Raising a verification threshold does not change those limits.

## Engine and generation interfaces

```python
counter_cheating.decide(
    response, assessed, events, recent_responses, challenges,
    *, interview_mode, current_turn, max_turns, question=None, settings=None,
) -> dict

counter_cheating.verification_result(question, response) -> dict | None
gemini_service.generate_verification_question(**context) -> dict
verification_questions.validate_question(data, context) -> dict
verification_questions.fallback_question(context) -> dict
assessment.load_evidence(cur, interview_id) -> dict
assessment.assess_response(response, evidence) -> dict
assessment.events_for_response(response, evidence, strict_boundary=False) -> list[dict]
assessment.assess(cur, interview_id, responses, interview_mode="standard") -> tuple[dict, dict]
verification_report.build(cur, interview) -> dict
```

Generation receives bounded role, previous question/answer/topic, current adaptive difficulty, private grading rubric, strengths, missing concepts, recent question history and whether the previous answer was coding. It receives no risk decision, biometric data, raw camera frames, contact information or hidden coding tests. Supplied text is treated as data in a dedicated prompt.

Allowed challenge types are `application`, `reasoning`, `edge_case`, `calculation`, `debugging` and `trade_off`. Validation requires a question of 30–1,200 characters, a nonblank target of at most 160 characters and 1–8 private rubric points of at most 500 characters each. It rejects malformed output, accusations/disclosure phrases, code in the question, copied answers/rubric text, near-duplicate questions and definition/yes-or-no-only probes. The server fixes difficulty, `kind='verify'`, neutral reason and other policy fields.

Missing credentials, request failure, malformed output or rejection returns a deterministic relevant question. The fallback uses a concept supported by the answer/rubric and does not claim the candidate discussed a missing concept. Coding fallbacks ask for execution, complexity or a boundary case of the submitted solution, without reproducing code or hidden tests. Validation and fallback selection check the full bounded interview history (up to 20 turns), while the model prompt receives the latest six. Local candidates also pass validation, with deterministic alternate probes when earlier variants were used. Model validation reduces disclosure and format failures; it cannot prove a question is pedagogically ideal.

## Database and API flow

`schema.sql` adds four nullable columns and a uniqueness index:

| Storage | Purpose |
| --- | --- |
| `interview_questions.verification_meta JSONB` | Parent response ID/index, versioned risk decision, families/codes, consumed evidence IDs, target/type and generation timestamp |
| `interview_responses.verification_result JSONB` | Accepted raw score, status, target, parent index and evaluation timestamp |
| `interview_responses.submitted_at TIMESTAMPTZ` | Server submission boundary captured before grading |
| `interview_responses.observation_start_seconds FLOAT` | Question/TTS start within the recording part, including preparation observations before the spoken answer; nonnegative when present |
| `verification_parent_response_unique_idx` | Unique interview + parent response ID for issued verification questions |
| Existing `interview_responses.integrity` | Historical private `counter_cheating` decision, retained when completion recomputes penalty fields |

Generation, question/rubric insertion, interview advancement and cached response `next_result` are part of the existing row-locked transaction. Retry returns the identical cached next question. Failure rolls the transaction back; the uniqueness index provides an additional defence against duplicate issuance.

| Request | Verification behavior |
| --- | --- |
| `POST /api/interviews/{id}/proctoring` | Store/deduplicate evidence and update episode duration |
| `POST /api/interviews/{id}/submit-answer` | Capture submission/observation boundaries, run ordinary spoken/typed grading, persist a verification result when applicable |
| `POST /api/interviews/{id}/code/submit` | Accept optional recording part/start/end and `observation_start_seconds` coordinates, with the same server submission boundary |
| `POST /api/interviews/{id}/next-question` | After the delivery barrier, assess stored eligible evidence and atomically issue/cache the next turn |
| `GET /api/interviews/{id}/state` | Return candidate-safe question/state data for resume |
| `POST /api/interviews/{id}/complete` | Preserve existing integrity adjustments and include verification totals/details/timeline |
| `GET /api/interviews/{id}/report` | Rebuild the same verification aggregates from stored issued questions/results |

Live question, state, evaluation and advancement projections omit internal risk, trigger evidence and `verification_meta`; the candidate sees `kind='verify'`, `is_verification=true`, the neutral question, normal TTS and the usual answer controls. The public advancement reason is “Knowledge verification challenge”. Existing Firebase ownership checks protect reports, identity images and recording playback.

Completion and saved-report responses expose:

```json
{
  "verification": { "challenges": 1, "passed": 1, "partial": 0, "failed": 0 },
  "integrity": {
    "verification": {
      "challenges": 1, "passed": 1, "partial": 0, "failed": 0,
      "details": [],
      "timeline": []
    }
  }
}
```

The empty lists above illustrate the shape; actual challenge details contain the question and parent indexes, trigger explanation, target/type, policy version/risk, consumed evidence, result or `null`, and generation time. Issued unanswered challenges count toward `challenges`, display “Unanswered”, and do not manufacture a failed result. Passed is a raw answer-quality score of 70+, partial is 50–69, and failed is below 50. Results are stored with the accepted answer, including on the final turn.

Verification grades and integrity-adjusted scores measure different things. For example, a verification answer may have raw grade 82 and display `PASSED 82%`; an existing assistance penalty can still cap an affected answer at 40. Verification does not erase the earlier evidence or remove existing penalties.

The report presents “Integrity evidence → Verification requested → Concept tested → Verification result”, challenge/pass/partial/fail counts and the existing identity, warning and penalty sections. Evidence links use stable event IDs; parent question links point into the interview journey. Older reports normalize absent verification metadata to zero counts and empty lists, with the old proctoring timeline retained.

The combined timeline is ordered by server receipt/generation/evaluation timestamps. Playback positions are recording-part offsets, starting again at each reload; these are a different time base from session/server timestamps. The UI labels `Part 2 · 0:12` separately from `Session time · 0:48` or an absolute server time. Server receipt time can follow an observation because delivery was delayed. Authenticated playback jumps to the stored part/offset, not to a converted server timestamp.

## Apply the schema while preserving data

On a new empty Docker database, initialization applies `schema.sql` automatically. Existing volumes require an explicit schema application after pulling this feature. From `deploy/local`:

```bash
docker compose up -d db
docker compose exec -T db psql -U interview -d interviews -v ON_ERROR_STOP=1 < ../../schema.sql
docker compose up -d --build
```

In Windows PowerShell, use `Get-Content ../../schema.sql -Raw | docker compose exec -T db psql -U interview -d interviews -v ON_ERROR_STOP=1` for the schema step; input redirection with `<` is the Bash/Git Bash form.

From production `deploy`, use the database settings already inside the container:

```bash
docker compose up -d db
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../schema.sql
docker compose up -d --build api
```

For native PostgreSQL, from the repository root:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
```

Use the connection string for the intended database. These commands keep its existing data and Docker volumes. Removing volumes is not a schema migration. The attached original instructions/document are not modified; [commands.md](../commands.md), [LOCAL_SETUP.md](LOCAL_SETUP.md) and [DEPLOYMENT.md](DEPLOYMENT.md) contain the maintained repository commands.

## Professor demo and validation

An illustrative report chain is:

```text
Phone detected during Q2 → Knowledge Verification Q3 → Binary-search complexity → PASSED 82%
```

The deterministic database acceptance fixture fixes Q2 to binary search, posts a stored phone episode during that answer, grades Q3 with an isolated test grader returning 82 and checks the persisted result/report. The fallback target may be phrased “binary search bounds”; exact generated wording and target depend on generation. It also checks duplicate evidence, identical retry, completion replay, strict wrong/post-answer boundaries and rollback followed by one issuance. This is evidence about the software chain, not measured camera accuracy or live Gemini grading quality.

Run the ordinary checks from the repository root:

```bash
.venv/bin/python -m pytest backend
npm test
npm run build
```

The database acceptance tests skip unless `COUNTER_CHEATING_TEST_DATABASE_URL` is set. Create a separate disposable PostgreSQL database accessible to a role that can apply `schema.sql` and install `pgcrypto`, then run, replacing the example credentials:

```bash
COUNTER_CHEATING_TEST_DATABASE_URL='postgresql://test_user:test_password@localhost:5432/counter_cheating_test' \
  .venv/bin/python -m pytest backend/test_counter_cheating_flow.py -q
```

Windows PowerShell:

```powershell
$env:COUNTER_CHEATING_TEST_DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/counter_cheating_test'
.venv/Scripts/python -m pytest backend/test_counter_cheating_flow.py -q
```

The fixture applies the actual schema twice per test to check rerunnability. It creates a unique test-owned user and, in cleanup, deletes only that user and its cascading test records. Schema changes remain in the selected database, so never point this variable at the application's database. Gemini grading/embeddings are controlled test doubles; authentication is replaced with the unique fixture user.

For a physical camera demonstration:

1. Open a Standard interview in Chrome or Edge with camera/microphone permission, a visible face and good lighting. Use a concept in the current question/answer; Q2 is not guaranteed to be binary search in an ordinary session.
2. While actively answering Q2, hold a real phone clearly in the camera frame for several seconds. Avoid extra browser departures or other violations that could terminate the interview first.
3. If a confirmed phone episode is recorded, close the answer. With an available turn and challenge budget, the next question is labelled “Knowledge Verification” and spoken normally. Answer its reasoning or application probe.
4. Finish and inspect the report: evidence linked to Q2, issued Q3, the actual target, raw verification status/score, existing penalties and recording playback. A physical run is not expected to reproduce the controlled 82 score.

The browser's [MediaPipe EfficientDet Lite0 scene monitor](../src/services/sceneMonitor.js) recognizes `cell phone` detections at confidence 0.4 or higher. `startSceneMonitor()` samples roughly every 1,000 ms; a phone condition must remain observed for at least 1,500 ms, which normally requires about three successive sampled detections, and clears after 3,000 ms without the condition. Model loading, frame availability and inference time can lengthen this. These checks operate on the camera frame in the browser and make no claim about a phone outside the frame.

A successful real physical phone-detection demonstration has not yet been verified. Detector loading, lighting, occlusion, device angle/distance and false positives can affect the physical result. Browser observations are untrusted measurements; sustained confirmation and attribution improve handling but do not prove authenticity. Reading/voice heuristics can also be noisy, and offline grading is approximate. Verification is an evaluation aid and cannot establish or disprove cheating.
