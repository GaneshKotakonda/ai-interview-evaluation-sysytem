// -------------------------------------------------------------
// Backend API client
// -------------------------------------------------------------
// Every call goes through `request`, which builds the URL, sends the body,
// and turns a non-2xx response into an Error carrying:
//   error.message  the short, stable message given by the caller
//   error.status   the HTTP status code (e.g. 409, 500)
//   error.detail   FastAPI's `detail` text, when the server sent one
// Pages show their own friendly messages; status/detail help with debugging
// and with special cases such as a 409 "hint already used".

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

const interviewPath = (interviewId, suffix) =>
  `${API_BASE_URL}/api/interviews/${encodeURIComponent(interviewId)}/${suffix}`;

const userPath = (firebaseUid, suffix) =>
  `${API_BASE_URL}/api/users/${encodeURIComponent(firebaseUid)}/${suffix}`;

// Every endpoint (except /api/health) requires the signed-in user's Firebase
// ID token. AuthContext registers the provider; Firebase's getIdToken()
// returns a cached token and refreshes it shortly before it expires.
let authTokenProvider = async () => null;

export function setAuthTokenProvider(provider) {
  authTokenProvider = provider;
}

async function request(url, { method = 'GET', json, formData } = {}, failureMessage) {
  const options = { method, headers: {} };
  const token = await authTokenProvider();
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  } else if (formData) {
    // The browser sets the multipart boundary header itself.
    options.body = formData;
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(failureMessage);
    error.status = response.status;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') error.detail = body.detail;
    } catch {
      // Non-JSON error body (proxy page, empty body): keep the generic message.
    }
    throw error;
  }
  return response.json();
}

export const api = {
  // 1. Create a session and receive the first adaptive question.
  startInterview(
    roleTitle = 'Software Engineer',
    firebaseUid = null,
    jobDescription = null,
    email = null,
    fullName = null,
    maxTurns = 5,
    interviewMode = 'standard',
  ) {
    return request(`${API_BASE_URL}/api/interviews/start`, {
      method: 'POST',
      json: {
        role_title: roleTitle,
        firebase_uid: firebaseUid,
        email,
        full_name: fullName,
        job_description: jobDescription || null,
        max_turns: maxTurns,
        interview_mode: interviewMode,
      },
    }, 'Failed to start interview');
  },

  // 2. Submit one answer (text + optional recorded video). The backend grades
  // it immediately; resubmitting the same text returns the original result.
  submitAnswer(interviewId, { questionIndex, questionText, candidateAnswer, videoBlob }) {
    const formData = new FormData();
    formData.append('question_index', questionIndex);
    formData.append('question_text', questionText);
    formData.append('candidate_answer', candidateAnswer || '');
    if (videoBlob) {
      formData.append('video', videoBlob, `q_${questionIndex}.webm`);
    }
    return request(interviewPath(interviewId, 'submit-answer'), { method: 'POST', formData },
      'Failed to submit answer');
  },

  // 3. Advance after submitAnswer. Passing its response_id makes delayed
  // retries unambiguous even if another answer has since been submitted.
  nextQuestion(interviewId, responseId = null) {
    return request(interviewPath(interviewId, 'next-question'), {
      method: 'POST',
      json: responseId ? { response_id: responseId } : {},
    }, 'Failed to fetch next question');
  },

  // 4. Arena only: spend the single session hint on the active turn.
  useHint(interviewId, currentTurn) {
    return request(interviewPath(interviewId, 'hint'), {
      method: 'POST',
      json: { current_turn: currentTurn },
    }, 'Could not retrieve hint');
  },

  // 5. Arena only: saved results of a completed Arena session.
  getArenaResults(interviewId) {
    return request(interviewPath(interviewId, 'arena-results'), {}, 'Could not retrieve Arena results');
  },

  // 6. Standard only: aggregate saved evaluations into the final report.
  // `visionMetrics` may be {} when the camera model produced no data.
  completeInterview(interviewId, visionMetrics = {}, durationSeconds = 0) {
    const safeDuration = Number.isFinite(durationSeconds)
      ? Math.max(0, Math.round(durationSeconds))
      : 0;
    return request(interviewPath(interviewId, 'complete'), {
      method: 'POST',
      json: { vision_metrics: visionMetrics, duration_seconds: safeDuration },
    }, 'Failed to complete evaluation');
  },

  // 7. Saved Standard report, including every turn of the adaptive journey.
  getReport(interviewId) {
    return request(interviewPath(interviewId, 'report'), {}, 'Failed to fetch report');
  },

  // 8. All interview sessions for a Firebase user, newest first.
  getUserInterviews(firebaseUid) {
    return request(`${API_BASE_URL}/api/interviews/user/${encodeURIComponent(firebaseUid)}`, {},
      'Failed to fetch user history');
  },

  // 9. Owner-only: permanently delete one interview and its saved data.
  // The owner is identified by the ID token, not by anything in the URL.
  deleteInterview(interviewId) {
    return request(
      `${API_BASE_URL}/api/interviews/${encodeURIComponent(interviewId)}`,
      { method: 'DELETE' },
      'Failed to delete interview',
    );
  },

  // 10. Profile metadata plus aggregated practice statistics.
  getProfile(firebaseUid) {
    return request(userPath(firebaseUid, 'profile'), {}, 'Failed to load profile');
  },

  // 11. Create or update the stored name/email for this Firebase user.
  updateProfile(firebaseUid, { fullName = null, email = null } = {}) {
    return request(userPath(firebaseUid, 'profile'), {
      method: 'PUT',
      json: { full_name: fullName, email },
    }, 'Failed to save profile');
  },

  // 12. Every saved Standard report with its component scores, newest first.
  getUserReports(firebaseUid) {
    return request(userPath(firebaseUid, 'reports'), {}, 'Failed to load reports');
  },
};
