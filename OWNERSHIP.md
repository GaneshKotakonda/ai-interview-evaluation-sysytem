Our current AI Interview Evaluation System repo and divided the remaining work so that we can take the project from the current prototype to a complete working AI system.

**Ganesh – Frontend & UI/UX**

* Finish and polish the existing React UI
* Dashboard improvements
* Interview page improvements
* Connect frontend with backend/AI APIs
* Replace demo/static report values with real results
* Loading, error and retry states
* Final responsive UI
* Readiness page: device and consent checks, interviewer voice and accent picker with a spoken sample, resume upload form
* Code-editor UI for the coding round (CodeMirror)
* Arena and leaderboard screens, and the report pages

**Rohith – Database / Auth / Backend / Deployment**

* Complete Firebase integration (Firebase Authentication and Firebase Hosting)
* PostgreSQL schema for users, interviews, questions, answers, evaluation reports and integrity events (replaces Firestore)
* Save interview history
* Secure storage of audio/video recordings (served only to their owner)
* Backend/API setup and integration support: FastAPI endpoints and request validation
* Docker, Docker Compose, nginx, Caddy and GitHub Actions
* The isolated code-runner container for the coding round

**Shafreed – Speech-to-Text + NLP**

* Implement speech-to-text (faster-whisper)
* Convert interview audio to transcript
* Analyze answers using NLP/LLM
* Relevance, correctness, completeness and technical content scoring
* Communication/filler-word analysis
* Return structured scores through API
* Piper text-to-speech with four voices (female/male, American/British)
* Gemini question generation and the adaptive question engine
* RAG: embeddings and cosine-similarity retrieval of rubric points for grading
* Resume parsing and resume-based questions
* Non-answer (skip) detection

**Harsha – Computer Vision / Behaviour Analysis**

* Real face detection
* Eye-contact estimation
* Head pose / looking-away detection
* Face presence and attention metrics
* Facial-expression analysis
* Generate structured video-analysis scores
* Integrate the output with the backend/scoring system
* MediaPipe Face Landmarker and Object Detector (phone, extra person, book)
* Proctoring: fullscreen, tab and window rules, and warnings
* Identity checks: face (OpenCV YuNet/SFace) and voice (sherpa-onnx TitaNet)
* Malpractice and integrity signals, live gaze and background-sound warnings

**Himesh – Final Scoring + Report + Integration**

* Combine NLP + speech + vision results
* Define final scoring formula
* Generate overall score
* Generate strengths and areas for improvement
* Build final evaluation report
* Interview history/performance trends
* Integrate all modules into one complete workflow
* Strict scoring (skipped answers earn nothing) and the completion ratio
* Integrity verdict and answer penalties
* Ranked Arena rating
* Testing: pytest, vitest and CI

**Final target:**

Login → Dashboard → Camera/Mic Check → Interview → Audio/Video Capture → Speech-to-Text → NLP Evaluation + Computer Vision Analysis → Final Scoring → Real AI Feedback → Report → Interview History

Important: everyone should work in a separate Git branch and make PRs instead of directly changing `main`.

Let's focus on making the **actual AI evaluation work**, because the current repo already has most of the frontend interview workflow but the real AI analysis is still missing.

---

**Update (5 October 2026):** the system is now complete; see `docs/DEVELOPMENT_PLAN.md` for what was built. Agreed technical decisions:

* **Database:** PostgreSQL (kept instead of Firestore).
* **Speech-to-text:** faster-whisper (open source, runs on our server), with Gemini transcription as a fallback.
* **Recordings:** stored on the server and served only to their owner through an authenticated API endpoint (no Firebase Storage needed).
* **Deployment:** Firebase Hosting for the frontend and one Docker Compose server for the API and database; see `docs/DEPLOYMENT.md`.
