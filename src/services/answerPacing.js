// -------------------------------------------------------------
// Spoken-answer pacing, shared by the Standard Interview and the Arena
// -------------------------------------------------------------
// Once the candidate has spoken, SILENCE_TO_ADVANCE_MS of silence ends the
// answer; a countdown shows for the last two seconds and speaking again
// cancels it.
export const SILENCE_TO_ADVANCE_MS = 3000;
export const COUNTDOWN_FROM_MS = 1000;
// Spoken at least this long before silence can end an answer.
export const MIN_SPEECH_MS = 1200;
// No voice at all after this long: show a "we can't hear you" hint.
export const NO_VOICE_HINT_MS = 20000;
// Hard limit per answer.
export const MAX_ANSWER_MS = 3 * 60 * 1000;
export const TICK_MS = 200;
