// -------------------------------------------------------------
// Browser storage keys shared by the interview pages
// -------------------------------------------------------------
// One place for every key so pages cannot drift apart through a typo.
export const STORAGE_KEYS = {
  progress: 'ai-interview-progress',          // turns of the current Standard interview
  duration: 'ai-interview-duration',          // seconds spent, saved on completion
  visionMetrics: 'ai-interview-vision-metrics', // last BehaviorMonitor snapshot
  interviewId: 'current-interview-id',        // active Standard interview UUID
  latestReport: 'latest-evaluation-report',   // cached /complete response
  roleTitle: 'target-role-title',             // chosen on the Readiness page
  jobDescription: 'target-job-description',
  resumeText: 'target-resume-text',            // plain text parsed by /api/resume/parse (Readiness)
  resumeName: 'target-resume-name',
  arenaInterviewId: 'arena-interview-id',     // sessionStorage: last Arena UUID
  answerMode: 'interview-answer-mode',        // 'voice' (default) or 'typed', chosen on Readiness
  endedEarly: 'interview-ended-early',        // why proctoring ended it: 'away' or 'violations'
  codingRound: 'interview-coding-round',      // 'on' | 'off', chosen on Readiness (unset: decided by role)
};

// Coding round (VPL) chosen on Readiness: true, false, or null (let the
// server decide from the role and job description).
export function readCodingRound() {
  const value = localStorage.getItem(STORAGE_KEYS.codingRound);
  return value === 'on' ? true : value === 'off' ? false : null;
}

// How the candidate answers: spoken (default) or typed (accessibility /
// no microphone). Chosen on the Readiness page.
export function readAnswerMode() {
  return localStorage.getItem(STORAGE_KEYS.answerMode) === 'typed' ? 'typed' : 'voice';
}

// Forget everything about the previous Standard interview.
export function clearInterviewProgress() {
  [STORAGE_KEYS.progress, STORAGE_KEYS.duration, STORAGE_KEYS.visionMetrics, STORAGE_KEYS.endedEarly].forEach((key) =>
    localStorage.removeItem(key));
}

// -------------------------------------------------------------
// Locally saved adaptive journey
// -------------------------------------------------------------
// Turn details are kept for this browser's current interview and must never
// be mixed with another interview's report, so the stored id must match.
export function readInterviewJourney(interviewId) {
  try {
    const progress = JSON.parse(localStorage.getItem(STORAGE_KEYS.progress));
    return interviewId && progress?.interviewId === interviewId && Array.isArray(progress.responses)
      ? progress.responses.filter((response) => response.completed)
      : [];
  } catch {
    return [];
  }
}
