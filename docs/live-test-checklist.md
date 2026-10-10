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
- Identity and malpractice: after Start the identity check asks for one sentence read aloud; a second face during enrolment is refused. During the interview: a second person in view, a phone held up, covering the camera, someone else speaking while you keep your lips still, and someone else answering one question each show a warning with the count. In typed mode, text inserted by a tool is flagged. The report shows the verdict (Needs review or Invalid), reasons, the enrolment photo and flagged snapshots, and per-answer badges with "Scored 0" or "Capped at 40". A virtual camera (OBS) blocks Start.
- Rules and pacing: after Start the rules are read aloud and shown; "I understand" continues. In voice mode, 3 seconds of silence after speaking moves to the next question (countdown "Moving on in 2… 1"). The sidebar is hidden during the interview and the Arena.
- Away limit: Alt+Tab away and stay out; the dialog counts down and at 5 seconds the interview (or Arena) ends. 3 shorter warnings also end it.
- Coding round (VPL): with "Include a coding round" on, questions 2 and 4 show the problem and the code editor. Paste is blocked. Run shows each example's expected and actual output; "Also run my own input" works. Submit grades hidden tests; the report shows tests passed, language, complexity and the code.
- Ranked Arena: choose DSA with coding on; levels 3 and 5 are coding. Finish: the result shows rating change and rank. Leaving for 5 seconds ends the game with a penalty. The Leaderboard shows overall and category tabs.
