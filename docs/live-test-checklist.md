# Live Integration Checklist

These checks are manual and are not implied by automated tests.

- Apply `schema.sql` to a PostgreSQL test database and verify additive migration reruns safely.
- Configure Firebase login and verify Firebase UID maps to one PostgreSQL user UUID.
- Configure a real Gemini key; test question generation, immediate evaluation, and fallback behavior by temporarily disabling the key.
- Complete a Standard Interview: camera/mic permission, MediaRecorder upload, adaptive increase/decrease, eligible follow-up, completion, report, and dashboard history.
- Voice interview: `/api/health` shows `speech_to_text.loaded` and `text_to_speech.loaded` true. On Readiness, **Test speakers** plays the Piper voice through the default output device (try headphones too). Start Interview: intro and each question are spoken; answers end with Next and with a 7-second pause; staying silent shows "We can't hear you" after 20 s and the "I couldn't hear an answer" prompt on Next; the last question ends with the outro and the report.
- Recording: during the interview the network tab shows `/recording` uploads about every 10 s; the report's **Interview recording** plays and each "Play this answer" jumps to the right moment.
- Typed mode: choose **Type** on Readiness; questions are still spoken and typed answers are graded.
- Reload the page mid-interview and confirm it resumes the same question (and offers "Retry Next Question" if the last answer was saved but not advanced).
- Confirm another account cannot open the report, state or recording of your interview (404).
- Confirm camera UI uses observable language only and does not make psychological claims.
- Complete an Arena: setup topic display, one hint, XP, streak, hint penalty, difficulty, sixth-turn Boss Round, results, and browser refresh of results.
- Test failed answer submission and failed advancement separately; confirm retries do not duplicate responses or XP.
- Proctoring: Start Interview enters fullscreen; Esc, Alt+Tab, switching tab and clicking another window each show "You left the interview" with the warning count, and "Return to the interview" restores fullscreen. Paste in typed mode is blocked. At the limit the interview ends, the completion page says "Interview ended early", and the report shows the Integrity section and timeline.
