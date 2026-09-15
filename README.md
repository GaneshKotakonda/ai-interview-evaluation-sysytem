# AI Interview Evaluation System

A React + Vite academic prototype for the candidate-side mock interview workflow.

## Included

- Firebase email/password signup and login
- User display name saved with Firebase Auth profile
- Protected candidate routes
- Responsive dashboard UI
- Camera/microphone readiness checks
- Live browser camera preview
- MediaRecorder-based temporary answer recording
- Manual transcript/answer entry
- Question navigation with localStorage persistence
- Interview completion screen
- Clearly labeled mock/demo evaluation report

## Not included yet

- Real AI/LLM evaluation
- Whisper / speech-to-text
- Emotion or gaze analysis
- Firestore interview persistence
- Firebase Storage
- Admin/reviewer panels

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. Camera/microphone access works on localhost in modern browsers after permission is granted.

## Firebase

This project uses the Firebase configuration supplied for the academic prototype. Ensure **Email/Password** sign-in is enabled in Firebase Console > Authentication > Sign-in method.

## Notes

- Interview text progress is stored in `localStorage` under `ai-interview-progress`.
- Temporary MediaRecorder video remains in browser memory and is not uploaded.
- Report metrics are stored in `src/data/mockData.js` and are demonstration values only.
