# Standard Interview adaptive frontend

The Standard Interview consumes `question` from `/start`, then submits each answer
and its optional recording before requesting `/next-question` with the returned
`response_id`. It does not consume the compatibility `questions` array.

## State flow

Start → answer → finish recording (if needed) → submit/analyze → advance → next
answer or `/interview-complete` → aggregate report → `/report`.

- Difficulty and follow-up status come from each server-issued question.
- Progress uses `current_turn / max_turns`. Follow-ups count as turns.
- An accepted answer is read-only. There is no previous-turn edit control.
- A synchronous request guard prevents rapid duplicate submissions.
- A failed submission keeps the text and video for retry.
- A failed advancement keeps the accepted response ID and retries only advancement.
- Start failures show a retry screen. No local fixed-question fallback is used.
- Report generation can be retried without submitting answers again.

Camera and microphone capture, BehaviorMonitor, vision metrics and per-answer
WebM uploads remain in place. Submission waits for MediaRecorder's final
`dataavailable` and `stop` events. Camera tracks remain live across turns and stop
on completion/unmount; answer preview URLs are released after advancement.

The report journey is saved in browser localStorage and scoped to the interview
ID. The existing backend report endpoint provides aggregate scores, not turn
history; journey details are unavailable on another browser or after clearing
local storage. Refresh recovery for an active interview is not implemented:
keep the interview page open while retrying. A page reload starts a new session,
as in the previous frontend.

## Manual browser checks

1. Apply the migration and configure/start the backend as described in
   [adaptive-backend.md](adaptive-backend.md). Run `npm run dev`, sign in, and
   start a Standard Interview through readiness.
2. Allow camera/microphone access. Check the live preview and BehaviorMonitor.
   Verify turn 1, Medium difficulty, and the backend-provided maximum turn count.
3. Type an answer and record video. Submit while recording: verify the final
   video is uploaded in the multipart request. Observe “Analyzing your response…”
   followed by “Preparing the next question…”.
4. Confirm the next turn appears with the backend's difficulty. When the backend
   returns `is_follow_up: true`, confirm the “AI Follow-up” badge. Confirm the
   camera remains live and the previous video preview is cleared.
5. In browser developer tools, block `*/next-question` while allowing
   `*/submit-answer`. Submit. Confirm the answer becomes read-only. Unblock the
   endpoint and click “Retry Next Question”. The network panel must show only
   another next-question request, with the original response ID.
6. Block `*/submit-answer`. Submit, verify text/video remain, then unblock and
   retry. Rapid clicks during a request must produce only one submission.
7. Continue until the server returns `is_complete: true`. Confirm `/complete`
   receives duration and vision metrics; inspect the dynamic answer count and
   open the report. Check the ordered journey, difficulty, follow-ups and scores.
8. Repeat while blocking `*/complete`. Confirm the report cannot be opened until
   “Retry Report Generation” succeeds.

Automated checks use mocked API/media boundaries. Real hardware permissions,
Gemini responses, and live database behavior require the browser checks above.
