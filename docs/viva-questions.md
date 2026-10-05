# IntervueAI Viva Questions

1. **What makes this more than a ChatGPT wrapper?** It keeps persistent adaptive state, uses rubric retrieval, evaluates each saved response, applies deterministic difficulty rules, limits follow-ups, supports observable camera signals, and has a separate Arena layer.
2. **Why use RAG?** Retrieved rubric concepts ground evaluation in the issued question rather than relying only on a general model response.
3. **Why not let Gemini choose difficulty?** Deterministic thresholds make transitions explainable, repeatable, and testable.
4. **How are follow-ups controlled?** They require an eligible partial answer and cannot occur consecutively.
5. **How do you prevent infinite follow-ups?** The backend rejects a follow-up after a follow-up; every turn also counts toward the configured maximum.
6. **How is XP calculated?** A deterministic combination of answer score, difficulty bonus, streak bonus, and a one-time hint penalty.
7. **How is duplicate XP prevented?** Each Arena award is tied to a unique persisted response in `arena_turns` inside the advancement transaction.
8. **Why separate Standard Interview and Arena?** Standard is professional coaching/reporting; Arena is deliberately gamified practice with different presentation and rules.
9. **What does MediaPipe measure?** Face presence, approximate screen-gaze direction, and head alignment from landmarks; these are observable estimates.
10. **Does eye contact mean confidence?** No. It is only an observable camera-engagement signal.
11. **How are answers evaluated?** Gemini evaluation is grounded by retrieved rubric concepts, with deterministic fallback handling when a live service fails.
12. **Why PostgreSQL?** It provides relational integrity, UUID-linked session data, constraints, indexes, and transactional idempotency.
13. **How do you handle Gemini failure?** Question, Boss Round, and hint paths use deterministic fallbacks; failure must not corrupt saved state.
14. **What if the network fails after submission?** The frontend retries the same payload; after acceptance it retries advancement only using the persisted response ID.
15. **What are limitations?** LLM variability, approximate camera metrics, filler-based speech fluency, and limited active-session refresh recovery.
16. **Is it intended for hiring decisions?** No. It is a coaching and evaluation-support tool.
17. **What is deterministic versus AI-driven?** Gemini generates/evaluates; backend rules decide difficulty, follow-up limits, XP, streaks, hints, and Boss Round placement.
18. **How is difficulty adjusted?** ≥85 increases; 70–84 stays level and changes topic; 50–69 can follow up; <50 decreases.
19. **Why is the Boss Round different?** It is a final game-mode-only scenario that tests multi-concept reasoning and never appears in Standard mode.
20. **What would you add next?** Speech-to-text, acoustic analysis, resume-aware questions, session recovery, and longitudinal learning analytics.
21. **How does speech-to-text work?** The browser records an audio-only track next to the video. The server transcribes it with faster-whisper (open-source Whisper on CTranslate2, MIT licence) with word timestamps, voice-activity filtering and a prompt that keeps filler words. The candidate reviews and edits the transcript before it is graded.
22. **Why faster-whisper instead of a cloud STT API?** It runs locally (audio stays on our server), costs nothing per minute, and is fast on a CPU: a 17-second answer took about 2 seconds with `base.en`. Gemini transcription is only a fallback.
23. **How is speech delivery measured?** From Whisper word timestamps: words per minute, filler words per minute and pauses over 1.5 s, each with a documented penalty. It measures timing, not tone or confidence.
24. **What are the four answer criteria?** Correctness 35%, completeness 25%, technical depth 25%, relevance 15%. Their weighted mean is the answer-quality score, so the adaptive difficulty thresholds stay the same.
25. **How is the overall score explainable?** Every report stores the scoring version and the weights actually applied after dropping missing components; the report page lists them.
26. **How are recordings protected?** They are never served from a public path. The owner fetches them through an authenticated endpoint that checks the Firebase ID token and interview ownership; deleting an interview deletes its files.
27. **How are questions spoken?** Piper, an open-source neural text-to-speech engine, runs on our server (about 0.3 s per question once loaded). Audio is cached on disk; the browser plays it through the system's current output device and falls back to the browser's own voice if the server voice is unavailable.
28. **How does the interview know an answer is finished?** The candidate selects Next, or the Web Audio API detects about 4 s of silence after speech and starts a 3-second countdown that speaking again cancels. There is also a 3-minute limit per answer. The silence threshold adapts to the room's background noise.
29. **If scores are hidden until the end, how do questions still adapt?** Every answer is transcribed and graded silently as soon as it ends; the next question is chosen from that grade. At the end one extra Gemini call reads the whole transcript and writes the holistic summary.
30. **How is the whole interview recorded safely?** MediaRecorder sends a chunk every 10 seconds; the server appends chunks in order (duplicates from retries are ignored), so a crash loses seconds, not the interview. Each answer stores its start and end time in the recording for playback.
