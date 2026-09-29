# IntervueAI Faculty Demo Guide (5–8 minutes)

1. **Dashboard (30 seconds):** Log in and point out the separate Standard Interview and Interview Arena cards. Explain that history is PostgreSQL-backed and stays empty until a real session is completed.
2. **Standard Interview (2 minutes):** Open Readiness, choose a role, grant camera/mic permissions, and start. Show the Medium question, camera-engagement panel, and answer entry. Give a strong answer and show the next difficulty increasing. Give a partial answer to demonstrate a contextual AI Follow-up when the policy permits it.
3. **Report (1 minute):** Finish the session and open the report. Show Adaptive Interview Journey: topic, difficulty, follow-up status, answer-quality score, and adaptation reason. State that camera signals are observable approximations, not personality or confidence judgements.
4. **Arena (2 minutes):** Select a practice topic, start the challenge, and show XP, streak, level, one hint, and adaptive difficulty. Explain that XP and streak calculations are backend-authoritative. Navigate through the sixth turn to show the game-only Boss Round.
5. **Arena results (45 seconds):** Show persisted total XP, best streak, Boss Round score, real strongest areas, and areas to practise. Refresh to demonstrate results reload.
6. **Architecture (30 seconds):** Gemini handles generation/evaluation; deterministic backend rules control difficulty, follow-up limits, XP, streaks, hint penalty, and Boss Round. PostgreSQL persists users, sessions, responses, and Arena state.

Use a prepared local database and valid Firebase/Gemini configuration for a live demo. Do not describe mocked or fallback output as a live AI result.
