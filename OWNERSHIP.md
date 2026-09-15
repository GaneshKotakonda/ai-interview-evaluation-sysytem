Our current AI Interview Evaluation System repo and divided the remaining work so that we can take the project from the current prototype to a complete working AI system.

**Ganesh – Frontend & UI/UX**

* Finish and polish the existing React UI
* Dashboard improvements
* Interview page improvements
* Connect frontend with backend/AI APIs
* Replace demo/static report values with real results
* Loading, error and retry states
* Final responsive UI

**Rohith – Firebase / Database / Storage**

* Complete Firebase integration
* Firestore for users, interviews, answers and evaluation results
* Firebase Storage for audio/video
* Save interview history
* Security rules
* Backend/API setup and integration support

**Shafreed – Speech-to-Text + NLP**

* Implement speech-to-text (Whisper or suitable STT)
* Convert interview audio to transcript
* Analyze answers using NLP/LLM
* Relevance, correctness, completeness and technical content scoring
* Communication/filler-word analysis
* Return structured scores through API

**Harsha – Computer Vision / Behaviour Analysis**

* Real face detection
* Eye-contact estimation
* Head pose / looking-away detection
* Face presence and attention metrics
* Facial-expression analysis
* Generate structured video-analysis scores
* Integrate the output with the backend/scoring system

**Himesh – Final Scoring + Report + Integration**

* Combine NLP + speech + vision results
* Define final scoring formula
* Generate overall score
* Generate strengths and areas for improvement
* Build final evaluation report
* Interview history/performance trends
* Integrate all modules into one complete workflow

**Final target:**

Login → Dashboard → Camera/Mic Check → Interview → Audio/Video Capture → Speech-to-Text → NLP Evaluation + Computer Vision Analysis → Final Scoring → Real AI Feedback → Report → Interview History

Important: everyone should work in a separate Git branch and make PRs instead of directly changing `main`.

Let's focus on making the **actual AI evaluation work**, because the current repo already has most of the frontend interview workflow but the real AI analysis is still missing.