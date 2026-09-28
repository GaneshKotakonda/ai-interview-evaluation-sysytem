// The report API returns aggregate scores. Turn details are kept for this
// browser's current interview and must never be mixed with another report.
export function readInterviewJourney(interviewId) {
  try {
    const progress = JSON.parse(localStorage.getItem('ai-interview-progress'));
    return interviewId && progress?.interviewId === interviewId && Array.isArray(progress.responses)
      ? progress.responses.filter((response) => response.completed)
      : [];
  } catch {
    return [];
  }
}
