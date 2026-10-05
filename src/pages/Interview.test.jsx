// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Interview from './Interview';

const { api, navigate, speech, monitor, session, answerRecording } = vi.hoisted(() => ({
  api: {
    startInterview: vi.fn(), submitAnswer: vi.fn(), nextQuestion: vi.fn(),
    transcribeAnswer: vi.fn(), getInterviewState: vi.fn(),
  },
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
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user-1', email: 'c@x.com', displayName: 'Candidate' } }) }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => navigate }));
vi.mock('../components/BehaviorMonitor', () => ({ default: () => <div>Behavior monitor</div> }));

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
  speech.speak.mockResolvedValue();
  monitor.snapshot.mockReturnValue(quiet);
  session.elapsedSeconds.mockReturnValue(12);
  session.stop.mockResolvedValue();
  answerRecording.stop.mockResolvedValue(new Blob(['spoken answer'], { type: 'audio/webm' }));
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 2 });
  api.transcribeAnswer.mockResolvedValue({ transcript: 'Use resources and HTTP verbs.' });
  api.submitAnswer.mockResolvedValue({ response_id: 'response-1', evaluation: { answer_quality_score: 90 } });
  api.nextQuestion.mockResolvedValue({ next_question: next, current_turn: 2, max_turns: 2, is_complete: false });
});
afterEach(cleanup);

function renderInterview() {
  return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Interview /></MemoryRouter>);
}

async function startAndListen() {
  renderInterview();
  fireEvent.click(await screen.findByRole('button', { name: 'Start Interview' }));
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
  monitor.snapshot.mockReturnValue({ ...quiet, speaking: false, speechMs: 3000, silenceMs: 5200, elapsedMs: 9000 });
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
  fireEvent.click(await screen.findByRole('button', { name: 'Start Interview' }));
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
