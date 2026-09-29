# Live Integration Checklist

These checks are manual and are not implied by automated tests.

- Apply `schema.sql` to a PostgreSQL test database and verify additive migration reruns safely.
- Configure Firebase login and verify Firebase UID maps to one PostgreSQL user UUID.
- Configure a real Gemini key; test question generation, immediate evaluation, and fallback behavior by temporarily disabling the key.
- Complete a Standard Interview: camera/mic permission, MediaRecorder upload, adaptive increase/decrease, eligible follow-up, completion, report, and dashboard history.
- Confirm camera UI uses observable language only and does not make psychological claims.
- Complete an Arena: setup topic display, one hint, XP, streak, hint penalty, difficulty, sixth-turn Boss Round, results, and browser refresh of results.
- Test failed answer submission and failed advancement separately; confirm retries do not duplicate responses or XP.
