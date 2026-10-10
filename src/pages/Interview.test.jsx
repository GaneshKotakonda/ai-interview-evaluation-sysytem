// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Interview from './Interview';

const { api, navigate, speech, monitor, session, answerRecording, proctor, behavior, scene, camera } = vi.hoisted(() => ({
  api: {
    startInterview: vi.fn(), submitAnswer: vi.fn(), nextQuestion: vi.fn(),
    transcribeAnswer: vi.fn(), getInterviewState: vi.fn(), reportProctoringEvents: vi.fn(),
    enrollIdentity: vi.fn(), identitySnapshot: vi.fn(), submitCode: vi.fn(),
  },
  behavior: { props: null },
  scene: { onEvent: null, latest: vi.fn(), stop: vi.fn() },
  camera: { captureFrame: vi.fn() },
  proctor: { callbacks: null, enterFullscreen: vi.fn(), exitFullscreen: vi.fn(), check: vi.fn(), stop: vi.fn(), away: false },
  navigate: vi.fn(),
  speech: { speak: vi.fn(), stopSpeaking: vi.fn(), playTurnChime: vi.fn() },
  monitor: { snapshot: vi.fn(), reset: vi.fn(), stop: vi.fn() },
  session: { part: 1, elapsedSeconds: vi.fn(), stop: vi.fn(), pending: vi.fn() },
  answerRecording: { stop: vi.fn(), cancel: vi.fn() },
}));
vi.mock('../services/api', () => ({ api }));
vi.mock('../services/speech', () => speech);
vi.mock('../services/voiceActivity', () => ({ createVoiceMonitor: () => monitor }));
vi.mock('../services/sessionRecorder', () => ({ startSessionRecording: () => session }));
vi.mock('../services/answerRecorder', () => ({ startAnswerRecording: () => answerRecording }));
vi.mock('../services/proctoring', () => ({
  enterFullscreen: (...args) => proctor.enterFullscreen(...args),
  exitFullscreen: (...args) => proctor.exitFullscreen(...args),
  fullscreenSupported: () => true,
  hasMultipleDisplays: () => false,
  startProctoring: (callbacks) => {
    proctor.callbacks = callbacks;
    return { check: proctor.check, stop: proctor.stop, isAway: () => proctor.away };
  },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user-1', email: 'c@x.com', displayName: 'Candidate' } }) }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => navigate }));
vi.mock('../components/BehaviorMonitor', () => ({
  default: (props) => {
    behavior.props = props;
    return <div>Behavior monitor</div>;
  },
}));
vi.mock('../services/sceneMonitor', () => ({
  startSceneMonitor: ({ onEvent }) => {
    scene.onEvent = onEvent;
    return { latest: scene.latest, stop: scene.stop };
  },
}));
vi.mock('../services/cameraSnapshot', () => ({ captureFrame: (...args) => camera.captureFrame(...args) }));
vi.mock('../components/CodingWorkspace', () => ({
  default: ({ question, onSubmit }) => (
    <div>
      <p>VPL for {question.coding.title}</p>
      <button type="button" onClick={() => onSubmit({ language: 'python', code: 'print(1)' })}>Submit solution</button>
    </div>
  ),
}));

const first = { index: 1, question: 'Design an API', difficulty: 'medium', is_follow_up: false };
const next = { index: 2, question: 'Explain API tradeoffs', difficulty: 'hard', is_follow_up: true };
const quiet = { level: 0.1, speaking: true, speechMs: 0, silenceMs: 0, elapsedMs: 1000, noiseFloor: 0.01 };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{}], getAudioTracks: () => [{}] }),
  } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); // not implemented by jsdom
  window.focus = vi.fn(); // not implemented by jsdom
  speech.speak.mockResolvedValue();
  monitor.snapshot.mockReturnValue(quiet);
  session.elapsedSeconds.mockReturnValue(12);
  session.stop.mockResolvedValue();
  answerRecording.stop.mockResolvedValue(new Blob(['spoken answer'], { type: 'audio/webm' }));
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 2 });
  api.transcribeAnswer.mockResolvedValue({ transcript: 'Use resources and HTTP verbs.' });
  api.submitAnswer.mockResolvedValue({ response_id: 'response-1', evaluation: { answer_quality_score: 90 } });
  api.nextQuestion.mockResolvedValue({ next_question: next, current_turn: 2, max_turns: 2, is_complete: false });
  api.reportProctoringEvents.mockResolvedValue({});
  proctor.enterFullscreen.mockResolvedValue(true);
  proctor.exitFullscreen.mockResolvedValue();
  proctor.away = false;
  proctor.callbacks = null;
  scene.latest.mockReturnValue({ persons: 1, phones: 0, books: 0 });
  camera.captureFrame.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  behavior.props = null;
});
afterEach(cleanup);

function renderInterview() {
  return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Interview /></MemoryRouter>);
}

// Start, then accept the rules (read aloud first).
async function clickStart() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start Interview' }));
  fireEvent.click(await screen.findByRole('button', { name: /I understand/ }));
}

async function startAndListen() {
  renderInterview();
  await clickStart();
  await screen.findByText('Listening');
}

it('speaks the intro and question, then listens; Next transcribes and grades silently', async () => {
  await startAndListen();
  expect(speech.speak).toHaveBeenCalledWith({ interviewId: 'session-1', item: 'intro' }, expect.any(String));
  expect(speech.speak).toHaveBeenCalledWith({ interviewId: 'session-1', item: 'question-1' }, expect.stringContaining('Design an API'));
  expect(speech.playTurnChime).toHaveBeenCalled();
  expect(api.startInterview).toHaveBeenCalledWith('Software Engineer', 'user-1', null, 'c@x.com', 'Candidate', 5, 'standard', 'voice');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); // no typing or editing in voice mode
  expect(screen.queryByRole('button', { name: /record again/i })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  await screen.findByText(next.question);
  expect(api.transcribeAnswer).toHaveBeenCalledWith('session-1', 1, expect.any(Blob));
  expect(api.submitAnswer).toHaveBeenCalledWith('session-1', expect.objectContaining({
    candidateAnswer: 'Use resources and HTTP verbs.', recording: { part: 1, start: 12, end: 12 },
  }));
  expect(api.nextQuestion).toHaveBeenCalledWith('session-1', 'response-1');
  expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
  expect(screen.getByText('AI Follow-up')).toBeInTheDocument();
  expect(speech.speak).toHaveBeenCalledWith({ interviewId: 'session-1', item: 'question-2' }, expect.any(String));
  // No scores are shown during the interview.
  expect(screen.queryByText(/90/)).not.toBeInTheDocument();
});

it('finishes after the last question: outro, recording upload, then the report step', async () => {
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 1 });
  api.nextQuestion.mockResolvedValue({ is_complete: true, next_question: null, current_turn: 1, max_turns: 1 });
  await startAndListen();
  fireEvent.click(screen.getByRole('button', { name: /Finish Interview/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/interview-complete'));
  expect(speech.speak).toHaveBeenCalledWith({ interviewId: 'session-1', item: 'outro' }, expect.any(String));
  expect(session.stop).toHaveBeenCalled();
  expect(localStorage.getItem('ai-interview-duration')).not.toBeNull();
  expect(JSON.parse(localStorage.getItem('ai-interview-progress')).responses[0].completed).toBe(true);
});

it('moves on automatically after the candidate stops speaking', async () => {
  await startAndListen();
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, speechMs: 3000, silenceMs: 7500, elapsedMs: 12000 });
  await waitFor(() => expect(api.transcribeAnswer).toHaveBeenCalled(), { timeout: 2000 });
  await screen.findByText(next.question);
});

it('shows a countdown that speaking cancels, and a hint when no voice is heard', async () => {
  await startAndListen();
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, speechMs: 3000, silenceMs: 1500, elapsedMs: 9000 });
  expect(await screen.findByText(/Moving on in 2… keep talking to continue/)).toBeInTheDocument();
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: true, speechMs: 3500, silenceMs: 100, elapsedMs: 9500 });
  await waitFor(() => expect(screen.queryByText(/Moving on in/)).not.toBeInTheDocument());
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, speechMs: 0, silenceMs: 25000, elapsedMs: 25000 });
  expect(await screen.findByText(/We can't hear you/)).toBeInTheDocument();
  expect(api.transcribeAnswer).not.toHaveBeenCalled();
});

it('asks again once when no speech is detected, then records an empty answer', async () => {
  const noSpeech = Object.assign(new Error('x'), { status: 422 });
  api.transcribeAnswer.mockRejectedValue(noSpeech);
  await startAndListen();
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  await waitFor(() => expect(speech.speak).toHaveBeenCalledWith({ phrase: 'no_speech' }, expect.any(String)));
  await screen.findByText('Listening');
  expect(api.submitAnswer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  await screen.findByText(next.question);
  expect(api.submitAnswer).toHaveBeenCalledWith('session-1', expect.objectContaining({ candidateAnswer: '' }));
});

it('keeps the answer through a failed submission and retries without re-transcribing', async () => {
  api.submitAnswer.mockRejectedValueOnce(new Error('offline'));
  await startAndListen();
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Submission' }));
  await screen.findByText(next.question);
  expect(api.transcribeAnswer).toHaveBeenCalledTimes(1);
  expect(api.submitAnswer).toHaveBeenCalledTimes(2);
  expect(api.submitAnswer.mock.calls[1][1].candidateAnswer).toBe('Use resources and HTTP verbs.');
});

it('retries advancement only, once the answer was accepted', async () => {
  api.nextQuestion.mockRejectedValueOnce(new Error('offline'));
  await startAndListen();
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Next Question' }));
  await screen.findByText(next.question);
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
  expect(api.nextQuestion).toHaveBeenCalledTimes(2);
});

it('typed mode: still speaks questions, collects typed answers and never transcribes', async () => {
  localStorage.setItem('interview-answer-mode', 'typed');
  renderInterview();
  await clickStart();
  const box = await screen.findByRole('textbox', { name: 'Your answer' });
  expect(screen.getByRole('button', { name: 'Submit Answer' })).toBeDisabled();
  fireEvent.change(box, { target: { value: 'Typed answer about REST.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByText(next.question);
  expect(api.startInterview.mock.calls[0][7]).toBe('typed');
  expect(api.transcribeAnswer).not.toHaveBeenCalled();
  expect(api.submitAnswer).toHaveBeenCalledWith('session-1', expect.objectContaining({ candidateAnswer: 'Typed answer about REST.' }));
});

it('resumes after a reload and continues a saved-but-not-advanced answer', async () => {
  localStorage.setItem('current-interview-id', 'session-9');
  api.getInterviewState.mockResolvedValue({
    interview_id: 'session-9', status: 'in_progress', interview_mode: 'standard', current_turn: 1, max_turns: 2,
    question: first, answered: [{ index: 1, question: first.question, answer: 'Saved', completed: true, response_id: 'r1' }],
    pending_response_id: 'r1', awaiting_completion: false, recording_parts: [1],
  });
  renderInterview();
  expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue Interview' }));
  await screen.findByText(next.question);
  expect(api.startInterview).not.toHaveBeenCalled();
  expect(api.submitAnswer).not.toHaveBeenCalled();
  expect(api.nextQuestion).toHaveBeenCalledWith('session-9', 'r1');
});

it('starts a new interview when the saved one is finished', async () => {
  localStorage.setItem('current-interview-id', 'old');
  api.getInterviewState.mockResolvedValue({ status: 'completed', interview_mode: 'standard' });
  renderInterview();
  await screen.findByRole('button', { name: 'Start Interview' });
  expect(api.startInterview).toHaveBeenCalledTimes(1);
});

it('offers a retry when the interview cannot start', async () => {
  api.startInterview.mockRejectedValueOnce(new Error('offline'));
  renderInterview();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Start' }));
  await screen.findByRole('button', { name: 'Start Interview' });
});

// ---------------------------------------------------------------
// Proctoring
// ---------------------------------------------------------------
function leave(type = 'window_blur') {
  proctor.away = true;
  act(() => proctor.callbacks.onLeave({ id: `e-${Math.random()}`, type, types: new Set([type]), question_index: 1, part: 1, at: 30 }));
}

it('enters fullscreen on start and shows a warning when the candidate leaves', async () => {
  await startAndListen();
  expect(proctor.enterFullscreen).toHaveBeenCalled();
  leave('window_blur');
  expect(await screen.findByRole('alertdialog', { name: 'You left the interview' })).toBeInTheDocument();
  expect(screen.getByText('Warning 1 of 3')).toBeInTheDocument();
  await waitFor(() => expect(api.reportProctoringEvents).toHaveBeenCalledWith('session-1', [
    expect.objectContaining({ type: 'window_blur', question_index: 1, part: 1, at: 30, details: { types: ['window_blur'] } }),
  ]));
  fireEvent.click(screen.getByRole('button', { name: 'Return to the interview' }));
  await waitFor(() => expect(proctor.check).toHaveBeenCalled());
  expect(proctor.enterFullscreen).toHaveBeenCalledTimes(2);
  proctor.away = false;
  act(() => proctor.callbacks.onReturn({ id: 'e-back', type: 'window_blur', types: ['window_blur'], duration: 4.2 }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

it('does not move on by silence while the candidate is away', async () => {
  await startAndListen();
  leave('tab_hidden');
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, speechMs: 3000, silenceMs: 9000, elapsedMs: 12000 });
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(api.transcribeAnswer).not.toHaveBeenCalled();
});

it('ends the interview at the violation limit and completes it early', async () => {
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 2, proctoring: { max_violations: 2 } });
  await startAndListen();
  leave('window_blur');
  proctor.away = false;
  act(() => proctor.callbacks.onReturn({ id: 'x', type: 'window_blur', types: ['window_blur'], duration: 2 }));
  leave('fullscreen_exit');
  expect(await screen.findByRole('heading', { name: 'Interview ended' })).toBeInTheDocument();
  expect(localStorage.getItem('interview-ended-early')).toBe('violations');
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/interview-complete'), { timeout: 4000 });
  expect(session.stop).toHaveBeenCalled();
  expect(proctor.exitFullscreen).toHaveBeenCalled();
  expect(api.submitAnswer).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------
// Identity and malpractice detection
// ---------------------------------------------------------------
const face = { faceCount: 1, facePresent: true, eyeContact: true, headCentered: true, gazeX: 0.5, mouth: 0.1 };

it('enrols the candidate (photo + sentence read aloud) before the first question', async () => {
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 2, identity: { enabled: true, enrolled: false } });
  api.enrollIdentity
    .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422, detail: 'More than one face is visible. Only you should be in view; try again.' }))
    .mockResolvedValueOnce({ available: true, face: true, voice: true, enrolled: true });
  monitor.snapshot.mockReturnValue({ ...quiet, speechMs: 4000, silenceMs: 1500 });
  renderInterview();
  await clickStart();
  expect(await screen.findByText('Look at the camera and read this aloud')).toBeInTheDocument();
  expect(speech.speak).not.toHaveBeenCalledWith({ interviewId: 'session-1', item: 'intro' }, expect.any(String));
  fireEvent.click(screen.getByRole('button', { name: /Start reading/ }));
  expect(await screen.findByText(/More than one face is visible/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
  await screen.findByText('Listening');
  expect(api.enrollIdentity).toHaveBeenCalledWith('session-1', expect.any(Blob), expect.any(Blob));
  expect(screen.getByText('Verified at start')).toBeInTheDocument();
});

it('blocks starting with a virtual camera', async () => {
  navigator.mediaDevices.getUserMedia.mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ label: 'OBS Virtual Camera' }], getAudioTracks: () => [{ label: 'Microphone' }],
  });
  renderInterview();
  expect(await screen.findByText(/OBS Virtual Camera/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Interview' })).toBeDisabled();
});

it('warns and counts a violation when another person stays in view', async () => {
  await startAndListen();
  act(() => behavior.props.onFrame({ ...face, faceCount: 2 }, 1000));
  act(() => behavior.props.onFrame({ ...face, faceCount: 2 }, 2600));
  expect(await screen.findByRole('alertdialog', { name: 'Another person is in view' })).toBeInTheDocument();
  expect(screen.getByText('Warning 1 of 3')).toBeInTheDocument();
  await waitFor(() => expect(api.reportProctoringEvents).toHaveBeenCalledWith('session-1', [
    expect.objectContaining({ type: 'extra_person', question_index: 1 }),
  ]));
  fireEvent.click(screen.getByRole('button', { name: 'Continue the interview' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

it('shows a soft look-at-screen reminder that is not counted and logs one minor event', async () => {
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, noiseFloor: 0.0001 });
  await startAndListen();
  const away = { ...face, eyeContact: false };
  for (let t = 0; t <= 14000; t += 100) act(() => behavior.props.onFrame(away, 20000 + t));
  expect(await screen.findByText('Please look toward the interview screen.')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.queryByText(/^Warning \d of 3$/)).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalledWith(expect.stringMatching(/complete/), expect.anything());
  await waitFor(() => expect(api.reportProctoringEvents).toHaveBeenCalled());
  const events = api.reportProctoringEvents.mock.calls.flatMap(([, batch]) => batch);
  expect(events.filter((e) => e.type === 'looking_away')).toHaveLength(1);
  expect(events.some((e) => e.type === 'face_absent')).toBe(false);
});

it('warns when music keeps playing in the background while the candidate is silent', async () => {
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, noiseFloor: 0.004 });
  await startAndListen();
  for (let t = 0; t <= 5000; t += 100) act(() => behavior.props.onFrame(face, 30000 + t));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  for (let t = 5100; t <= 7000; t += 100) act(() => behavior.props.onFrame(face, 30000 + t));
  expect(await screen.findByRole('alertdialog', { name: 'Background sound was heard' })).toBeInTheDocument();
  await waitFor(() => expect(api.reportProctoringEvents).toHaveBeenCalledWith('session-1', [
    expect.objectContaining({ type: 'background_sound' }),
  ]));
});

it('does not flag a quiet room or the candidate speaking', async () => {
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: true, noiseFloor: 0.004 });
  await startAndListen();
  for (let t = 0; t <= 10000; t += 100) act(() => behavior.props.onFrame(face, 30000 + t));
  expect(screen.queryByRole('alertdialog', { name: 'Background sound was heard' })).not.toBeInTheDocument();
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, noiseFloor: 0.0002 });
  for (let t = 10100; t <= 20000; t += 100) act(() => behavior.props.onFrame(face, 30000 + t));
  expect(screen.queryByRole('alertdialog', { name: 'Background sound was heard' })).not.toBeInTheDocument();
});

it('warns when a phone is detected by the scene monitor', async () => {
  await startAndListen();
  act(() => scene.onEvent({ type: 'phone_detected', phase: 'start' }));
  expect(await screen.findByRole('alertdialog', { name: 'A phone is in view' })).toBeInTheDocument();
});

it('flags speech while the lips are still, and sends the answer signals', async () => {
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: true, speechMs: 500 });
  await startAndListen();
  for (let t = 0; t <= 6000; t += 100) {
    act(() => behavior.props.onFrame({ ...face, mouth: 0.05 }, 10000 + t));
  }
  expect(await screen.findByRole('alertdialog', { name: 'Another voice was heard' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue the interview' }));
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  await screen.findByText(next.question);
  const signals = api.submitAnswer.mock.calls[0][1].answerSignals;
  expect(signals.lip_sync.voiced_mouth_still_ms).toBeGreaterThan(5000);
  expect(signals.gaze.speaking_ms).toBeGreaterThan(5000);
});

it('shows the server identity warning after an answer in another voice', async () => {
  api.transcribeAnswer.mockResolvedValue({
    transcript: 'Answer.', identity: { verdict: 'mismatch', event: { type: 'voice_mismatch' }, violations: 1, max_violations: 5 },
  });
  await startAndListen();
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  expect(await screen.findByRole('alertdialog', { name: 'The answer was not in your voice' })).toBeInTheDocument();
  expect(screen.getByText('Warning 1 of 3')).toBeInTheDocument();
});

it('typed mode: text that appears without typing is flagged', async () => {
  localStorage.setItem('interview-answer-mode', 'typed');
  renderInterview();
  await clickStart();
  const box = await screen.findByRole('textbox', { name: 'Your answer' });
  fireEvent.change(box, { target: { value: 'A whole paragraph that was never typed by the candidate at all.' } });
  expect(await screen.findByRole('alertdialog', { name: 'Text was inserted into your answer' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue the interview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByText(next.question);
  expect(api.submitAnswer.mock.calls[0][1].answerSignals.typing).toEqual(expect.objectContaining({ largest_insert: 63, keystrokes: 0 }));
});

// ---------------------------------------------------------------
// Rules, away limit and the coding round
// ---------------------------------------------------------------
it('reads the rules aloud before the interview and waits for the candidate', async () => {
  renderInterview();
  fireEvent.click(await screen.findByRole('button', { name: 'Start Interview' }));
  expect(await screen.findByRole('heading', { name: 'Before we begin' })).toBeInTheDocument();
  expect(screen.getByText(/No AI tools, websites, notes/)).toBeInTheDocument();
  expect(screen.getByText(/staying away 5 seconds ends it immediately/)).toBeInTheDocument();
  expect(speech.speak).toHaveBeenCalledWith({ phrase: 'rules' }, expect.any(String));
  expect(speech.speak).not.toHaveBeenCalledWith({ interviewId: 'session-1', item: 'intro' }, expect.any(String));
  fireEvent.click(await screen.findByRole('button', { name: /I understand/ }));
  await screen.findByText('Listening');
});

it('ends the interview when the candidate stays outside longer than the limit', async () => {
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 2, proctoring: { max_violations: 3, max_away_seconds: 1 } });
  await startAndListen();
  leave('tab_hidden');
  expect(await screen.findByRole('timer')).toHaveTextContent(/ends in/);
  expect(await screen.findByRole('heading', { name: 'Interview ended' }, { timeout: 3000 })).toBeInTheDocument();
  expect(screen.getByText(/stayed outside the interview for more than 1 seconds/)).toBeInTheDocument();
  expect(localStorage.getItem('interview-ended-early')).toBe('away');
});

it('opens the VPL on a coding turn and submits the code', async () => {
  const coding = { index: 2, kind: 'coding', question: 'Coding problem: Two Sum.', difficulty: 'easy', coding: { title: 'Two Sum', statement: 'Find two numbers.' } };
  api.nextQuestion
    .mockResolvedValueOnce({ next_question: coding, current_turn: 2, max_turns: 2, is_complete: false })
    .mockResolvedValueOnce({ is_complete: true, next_question: null, current_turn: 2, max_turns: 2 });
  api.submitCode.mockResolvedValue({ response_id: 'code-1', evaluation: {} });
  await startAndListen();
  fireEvent.click(screen.getByRole('button', { name: /Next Question/ }));
  expect(await screen.findByText('VPL for Two Sum')).toBeInTheDocument();
  expect(answerRecording.stop).toHaveBeenCalledTimes(1); // no audio recording while coding
  fireEvent.click(screen.getByRole('button', { name: 'Submit solution' }));
  await waitFor(() => expect(api.submitCode).toHaveBeenCalledWith('session-1', expect.objectContaining({
    questionIndex: 2, language: 'python', code: 'print(1)',
  })));
  expect(api.nextQuestion).toHaveBeenLastCalledWith('session-1', 'code-1');
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/interview-complete'));
});
