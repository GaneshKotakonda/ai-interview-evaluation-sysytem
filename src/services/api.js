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

// File extension that matches what the browser actually recorded
// (Chrome/Firefox: webm, Safari: mp4).
function extensionFor(blob) {
  const type = blob?.type || '';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

// Authenticated binary download (recordings).
async function requestBlob(url, failureMessage) {
  const headers = {};
  const token = await authTokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const error = new Error(failureMessage);
    error.status = response.status;
    throw error;
  }
  return response.blob();
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
    answerMode = 'typed',
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
        ...(interviewMode === 'standard' ? { answer_mode: answerMode } : {}),
      },
    }, 'Failed to start interview');
  },

  // 2. Submit one answer (text + optional recorded video and this answer's
  // camera-engagement snapshot). The backend grades it immediately;
  // resubmitting the same text returns the original result.
  // `recording` = { part, start, end } locates the answer (in seconds) inside
  // the whole-interview recording, for playback from the report.
  submitAnswer(interviewId, { questionIndex, questionText, candidateAnswer, videoBlob, visionMetrics, recording }) {
    const formData = new FormData();
    formData.append('question_index', questionIndex);
    formData.append('question_text', questionText);
    formData.append('candidate_answer', candidateAnswer || '');
    if (videoBlob) {
      formData.append('video', videoBlob, `q_${questionIndex}.${extensionFor(videoBlob)}`);
    }
    if (visionMetrics) {
      formData.append('vision_metrics', JSON.stringify(visionMetrics));
    }
    if (recording) {
      formData.append('recording_part', recording.part);
      formData.append('answer_start_seconds', recording.start);
      formData.append('answer_end_seconds', recording.end);
    }
    return request(interviewPath(interviewId, 'submit-answer'), { method: 'POST', formData },
      'Failed to submit answer');
  },

  // 2b. Speech-to-text for a recorded answer. Returns the transcript for the
  // candidate to review; it does not grade. Re-recording replaces it.
  transcribeAnswer(interviewId, questionIndex, audioBlob) {
    const formData = new FormData();
    formData.append('question_index', questionIndex);
    formData.append('audio', audioBlob, `q_${questionIndex}_audio.${extensionFor(audioBlob)}`);
    return request(interviewPath(interviewId, 'transcribe'), { method: 'POST', formData },
      'Failed to transcribe answer');
  },

  // 2e. One chunk of the whole-interview recording (sent every ~10 s).
  uploadRecordingChunk(interviewId, part, seq, blob) {
    const formData = new FormData();
    formData.append('part', part);
    formData.append('seq', seq);
    formData.append('chunk', blob, `session_${part}_${seq}.${extensionFor(blob)}`);
    return request(interviewPath(interviewId, 'recording'), { method: 'POST', formData },
      'Failed to upload recording');
  },

  // 2f. Owner-only whole-interview recording (one part) as an object URL.
  async getRecordingUrl(interviewId, part) {
    const blob = await requestBlob(interviewPath(interviewId, `recording/${encodeURIComponent(part)}`),
      'Failed to load recording');
    return URL.createObjectURL(blob);
  },

  // 2g. Spoken interviewer audio (Piper). `item`: intro | outro | question-<n>.
  async getSpeechUrl(interviewId, item) {
    const blob = await requestBlob(interviewPath(interviewId, `speech/${encodeURIComponent(item)}`),
      'Speech unavailable');
    return URL.createObjectURL(blob);
  },

  // 2h. Fixed spoken phrase (speaker test, "thank you", …).
  async getPhraseUrl(phrase) {
    const blob = await requestBlob(`${API_BASE_URL}/api/speech/${encodeURIComponent(phrase)}`,
      'Speech unavailable');
    return URL.createObjectURL(blob);
  },

  // 2c. Current state of an active interview, used to resume after a reload.
  getInterviewState(interviewId) {
    return request(interviewPath(interviewId, 'state'), {}, 'Failed to load interview');
  },

  // 2d. Owner-only recording of one answer, as an object URL for <video>/<audio>.
  // The caller revokes the URL when it is no longer shown.
  async getAnswerMediaUrl(interviewId, questionIndex, kind = 'video') {
    const blob = await requestBlob(
      `${interviewPath(interviewId, `media/${encodeURIComponent(questionIndex)}`)}?kind=${kind}`,
      'Failed to load recording',
    );
    return URL.createObjectURL(blob);
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
  // `endedEarly`: proctoring ended the interview; unanswered turns score 0.
  completeInterview(interviewId, visionMetrics = {}, durationSeconds = 0, endedEarly = false) {
    const safeDuration = Number.isFinite(durationSeconds)
      ? Math.max(0, Math.round(durationSeconds))
      : 0;
    return request(interviewPath(interviewId, 'complete'), {
      method: 'POST',
      json: {
        vision_metrics: visionMetrics,
        duration_seconds: safeDuration,
        ...(endedEarly ? { ended_early: true } : {}),
      },
    }, 'Failed to complete evaluation');
  },

  // 6b. Proctoring: integrity events (leaving the interview, blocked actions).
  // `events`: [{ id, type, question_index, part, at, duration, details }].
  reportProctoringEvents(interviewId, events) {
    return request(interviewPath(interviewId, 'proctoring'), { method: 'POST', json: { events } },
      'Failed to record integrity event');
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
