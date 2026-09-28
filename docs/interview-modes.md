# Standard Interview and Interview Arena

## Scope

Dashboard offers two experiences. Standard Interview retains the existing
readiness, adaptive interview, completion and report flow. Arena offers setup
and a preview only. No game interview is started, and no scores, questions,
XP, streaks, levels or Boss Round mechanics are generated.

Both new routes (`/arena`, `/arena/play`) are inside the existing authenticated
application layout. Arena appears in desktop and mobile sidebar navigation.
History continues to use the existing real interview records.

## Configuration and API

Arena passes `arenaConfig` through React Router state. It contains `role_title`,
`topic`, `job_description`, `custom_description` and `interview_mode: "game"`.
It does not touch Standard Interview storage or call the backend. Direct play
entry without valid configuration offers a link back to setup.

The Standard start API client explicitly sends `interview_mode: "standard"`.
The backend accepts only `standard` and `game`, defaults omitted modes to
`standard` for older clients, persists the value and includes it in the start
response. Both modes currently use the same adaptive backend behavior.

## Migration

With the backend stopped and DATABASE_URL exported, apply the existing schema:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
```

The migration atomically replaces `interviews_interview_mode_check` with
`CHECK (interview_mode IN ('standard', 'game'))`. It preserves rows and can be
rerun. Apply it before starting a `game` session through the API. No database
migration is run automatically by this frontend change.

## Manual browser checks

1. Sign in and open `/dashboard`. Verify separate Standard Interview and Arena
   cards, including labels that identify Arena mechanics as upcoming.
2. Click Start Standard Interview. Verify `/readiness` → `/interview`; inspect
   the start request for `interview_mode: "standard"`. Run the adaptive flow,
   recording and retry checks in [adaptive-frontend.md](adaptive-frontend.md).
3. Verify Standard turns still show difficulty, follow-up indicators, camera,
   microphone and BehaviorMonitor. Finish and open the professional report.
4. Return to Dashboard and enter Arena. Select each practice area using the
   keyboard. Check the visible focus outline and checked radio state.
5. Select Custom Topic. Confirm an empty/whitespace topic cannot proceed; enter
   a topic and description and click Start Arena Challenge.
6. Verify `/arena/play` displays that topic, role and description and a disabled
   gameplay action. The network panel must show no interview-start request.
7. Open `/arena/play` in a fresh tab without route state. Use Choose Practice
   Area to return to setup. Check narrow/mobile layout and sidebar navigation.
8. Sign out and open each Arena URL. Confirm redirection to `/login`.
9. Verify Dashboard still loads real history and statistics.

## Database verification after migration

Inspect the constraint with:

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'interviews'::regclass
  AND conname = 'interviews_interview_mode_check';
```

On a test database, start one session for each accepted mode through `/docs`,
verify the stored mode, and verify another value is rejected with HTTP 422.
Apply the migration a second time to verify repeatability on that database.
