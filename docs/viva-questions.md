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
