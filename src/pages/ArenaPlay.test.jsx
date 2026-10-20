// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ArenaPlay from './ArenaPlay';
import { StrictMode } from 'react';
const { api, navigate, proctor, speech, recorder } = vi.hoisted(() => ({
  api: {
    startInterview: vi.fn(), submitAnswer: vi.fn(), nextQuestion: vi.fn(), useHint: vi.fn(),
    submitCode: vi.fn(), endArena: vi.fn(), reportProctoringEvents: vi.fn(), transcribeAnswer: vi.fn(),
  },
  navigate: vi.fn(),
  proctor: { callbacks: null, away: false },
  speech: { speak: vi.fn(), stopSpeaking: vi.fn(), playTurnChime: vi.fn() },
  recorder: { start: vi.fn() },
}));
vi.mock('../services/api', () => ({ api }));
vi.mock('../services/speech', () => speech);
vi.mock('../services/answerRecorder', () => ({ startAnswerRecording: (...args) => recorder.start(...args) }));
const monitor = vi.hoisted(() => ({ snap: { speaking: false } }));
vi.mock('../services/voiceActivity', () => ({ createVoiceMonitor: () => ({ snapshot: () => monitor.snap, reset: vi.fn(), stop: vi.fn() }) }));
vi.mock('../services/sceneMonitor', () => ({ startSceneMonitor: () => ({ latest: () => ({ persons: 1 }), stop: vi.fn() }) }));
vi.mock('../services/cameraSnapshot', () => ({ captureFrame: vi.fn().mockResolvedValue(null) }));
vi.mock('../components/BehaviorMonitor', () => ({ default: () => <div>Behavior monitor</div> }));
vi.mock('../components/CodingWorkspace', () => ({
  default: ({ question: q, onSubmit }) => (
    <div><p>VPL for {q.coding.title}</p><button type="button" onClick={() => onSubmit({ language: 'cpp', code: 'int main(){}' })}>Submit solution</button></div>
  ),
}));
vi.mock('../services/proctoring', () => ({
  enterFullscreen: vi.fn().mockResolvedValue(true),
  exitFullscreen: vi.fn().mockResolvedValue(),
  hasMultipleDisplays: () => false,
  startProctoring: (callbacks) => {
    proctor.callbacks = callbacks;
    return { check: vi.fn(), stop: vi.fn(), isAway: () => proctor.away, isOutside: () => true };
  },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user', email: 'user@test.com', displayName: 'Candidate' } }) }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => navigate }));
const config = { role_title: 'Frontend Developer', topic: 'React', job_description: 'React practice', interview_mode: 'game' };
const question = { index: 1, question: 'Explain React state', difficulty: 'medium', topic: 'State' };
const second = { index: 2, question: 'Explain render tradeoffs', difficulty: 'hard', topic: 'Rendering', is_follow_up: true };
const game = { base_xp: 88, difficulty_bonus: 10, streak_bonus: 0, hint_penalty: 0, xp_earned: 98, total_xp: 98, current_streak: 1, best_streak: 1, remaining_hints: 1 };
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  proctor.away = false;
  monitor.snap = { speaking: false };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ label: 'Camera' }], getAudioTracks: () => [{}] }),
  } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  window.focus = vi.fn();
  api.reportProctoringEvents.mockResolvedValue({});
  api.endArena.mockResolvedValue({});
  api.startInterview.mockResolvedValue({ interview_id: 'arena-id', interview_mode: 'game', current_turn: 1, max_turns: 6, question });
  api.submitAnswer.mockResolvedValue({ response_id: 'answer-id', evaluation: { answer_quality_score: 88, feedback: 'Clear explanation' } });
  api.nextQuestion.mockResolvedValue({ evaluation: { answer_quality_score: 88, feedback: 'Clear explanation' }, game, next_question: second, current_turn: 2, max_turns: 6, is_complete: false });
  api.transcribeAnswer.mockResolvedValue({ transcript: SPOKEN });
  speech.speak.mockResolvedValue();
  recorder.start.mockImplementation(() => ({ stop: vi.fn().mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' })), cancel: vi.fn() }));
});
const SPOKEN = 'State tracks changing component data.';
afterEach(cleanup);
// Ready screen → Start (fullscreen) → rules → the first level.
async function play() {
  fireEvent.click(await screen.findByRole('button', { name: /Start Ranked Arena/ }));
  fireEvent.click(await screen.findByRole('button', { name: /I understand/ }));
  await screen.findByText(question.question);
}
// The question is read, then the candidate answers out loud.
async function speakAnswer() {
  fireEvent.click(await screen.findByRole('button', { name: /Done answering/ }));
}
async function open() {
  render(<MemoryRouter initialEntries={[{ pathname: '/arena/play', state: { arenaConfig: config } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter>);
  await play();
}
async function submit() {
  await speakAnswer();
}
it('starts a proctored, ranked six-level game with the camera on', async () => {
  await open();
  expect(api.startInterview).toHaveBeenCalledWith('Frontend Developer', 'user', 'React practice', 'user@test.com', 'Candidate', 6, 'game');
  expect(screen.getByText('Level 1')).toBeInTheDocument();
  expect(screen.getByText('XP 0')).toBeInTheDocument();
  expect(screen.getByText('Streak 0')).toBeInTheDocument();
  expect(screen.getByText('Medium')).toBeInTheDocument();
  expect(document.querySelector('video')).not.toBeNull();
  expect(screen.getByText('0 of 3')).toBeInTheDocument();
});

it('passes the ranking category and coding choice to the server', async () => {
  render(<MemoryRouter initialEntries={[{ pathname: '/arena/play', state: { arenaConfig: { ...config, category: 'frontend', coding: true } } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter>);
  await play();
  expect(api.startInterview.mock.calls[0].slice(6)).toEqual(['game', 'typed', { arenaCategory: 'frontend', codingRound: true }]);
});

it('ends the game and applies penalties when the candidate stays away', async () => {
  api.startInterview.mockResolvedValue({ interview_id: 'arena-id', interview_mode: 'game', current_turn: 1, max_turns: 6, question, proctoring: { max_violations: 3, max_away_seconds: 1 } });
  await open();
  proctor.away = true;
  act(() => proctor.callbacks.onLeave({ id: 'e1', type: 'window_blur', types: new Set(['window_blur']), question_index: 1 }));
  expect(await screen.findByRole('heading', { name: 'Arena ended' }, { timeout: 3000 })).toBeInTheDocument();
  await waitFor(() => expect(api.endArena).toHaveBeenCalledWith('arena-id', 'away'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/arena/results'), { timeout: 4000 });
});

it('coding levels open the VPL and submit code', async () => {
  const codingLevel = { index: 3, kind: 'coding', question: 'Coding problem', difficulty: 'medium', topic: 'Coding: arrays', coding: { title: 'Max Subarray' } };
  api.nextQuestion.mockResolvedValueOnce({ evaluation: { answer_quality_score: 88 }, game, next_question: codingLevel, current_turn: 3, max_turns: 6, is_complete: false });
  api.submitCode.mockResolvedValue({ response_id: 'code-id' });
  await open(); await submit();
  fireEvent.click(await screen.findByRole('button', { name: 'Next Challenge' }));
  expect(await screen.findByText('VPL for Max Subarray')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Submit solution' }));
  await waitFor(() => expect(api.submitCode).toHaveBeenCalledWith('arena-id', expect.objectContaining({ questionIndex: 3, language: 'cpp' })));
});
it('holds the next question until the result is reviewed and uses returned XP', async () => {
  await open(); await submit();
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(screen.getByText('98 XP')).toBeInTheDocument();
  expect(screen.getByText('Base Answer XP')).toBeInTheDocument();
  expect(screen.getByText('Streak 1')).toBeInTheDocument();
  expect(screen.queryByText(second.question)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next Challenge' }));
  expect(screen.getByText(second.question)).toBeInTheDocument();
  expect(screen.getByText('Level 2')).toBeInTheDocument();
  expect(screen.getByText('AI Follow-up')).toBeInTheDocument();
  // The next question is read aloud, then the candidate answers again.
  await waitFor(() => expect(speech.speak).toHaveBeenCalledWith({ interviewId: 'arena-id', item: 'question-2' }, expect.stringContaining(second.question)));
  api.nextQuestion.mockResolvedValueOnce({ evaluation: { answer_quality_score: 60 }, game: { ...game, current_streak: 0, total_xp: 178 }, next_question: { ...second, index: 3 }, current_turn: 3, max_turns: 6 });
  await submit();
  await screen.findByText('Streak 0');
});
it('retains an accepted answer and retries advancement only', async () => {
  api.nextQuestion.mockRejectedValueOnce(new Error('offline'));
  await open(); await submit();
  await screen.findByRole('button', { name: 'Retry Advancement' });
  expect(screen.queryByRole('button', { name: /Done answering/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Advancement' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
  expect(api.nextQuestion).toHaveBeenLastCalledWith('arena-id', 'answer-id');
});
it('replays the exact payload after an uncertain submission and guards rapid clicks', async () => {
  let reject;
  api.submitAnswer.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await open();
  const done = await screen.findByRole('button', { name: /Done answering/ });
  fireEvent.click(done);
  fireEvent.click(done);
  await waitFor(() => expect(api.submitAnswer).toHaveBeenCalledTimes(1));
  expect(api.transcribeAnswer).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(screen.getByText(`“${SPOKEN}”`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Submission' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.submitAnswer.mock.calls[1][1]).toEqual(api.submitAnswer.mock.calls[0][1]);
});
it('shows Boss Round and finishes only after reviewing the final result', async () => {
  api.startInterview.mockResolvedValueOnce({ interview_id: 'arena-id', interview_mode: 'game', current_turn: 6, max_turns: 6, question: { ...question, index: 6, difficulty: 'expert', boss_round: true } });
  api.nextQuestion.mockResolvedValueOnce({ evaluation: { answer_quality_score: 88 }, game, is_complete: true, next_question: null });
  await open();
  expect(screen.getByRole('heading', { name: 'Boss Round' })).toBeInTheDocument();
  await submit();
  await screen.findByRole('button', { name: 'Finish Arena' });
  expect(api.submitAnswer).toHaveBeenCalledWith('arena-id', expect.objectContaining({ questionIndex: 6, candidateAnswer: SPOKEN }));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Finish Arena' }));
  expect(navigate).toHaveBeenCalledWith('/arena/results');
  expect(sessionStorage.getItem('arena-interview-id')).toBe('arena-id');
});
it('uses one hint and disables it after the server accepts usage', async () => {
  api.useHint.mockResolvedValue({ hint: 'Consider a concrete example.', remaining_hints: 0 });
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Use Hint' }));
  await screen.findByText('Consider a concrete example.');
  expect(screen.getByText('0 Hints')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Use Hint' })).toBeDisabled();
  expect(api.useHint).toHaveBeenCalledWith('arena-id', 1);
});

it('does not start an interview without a valid game setup', () => {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Choose Practice Area' })).toHaveAttribute('href', '/arena');
  expect(api.startInterview).not.toHaveBeenCalled();
});
it('shares the start request across StrictMode effect replays', async () => {
  render(<StrictMode><MemoryRouter initialEntries={[{ pathname: '/arena/play', state: { arenaConfig: config } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter></StrictMode>);
  await screen.findByRole('button', { name: /Start Ranked Arena/ });
  expect(api.startInterview).toHaveBeenCalledTimes(1);
});
it('offers retry after a failed start', async () => {
  api.startInterview.mockRejectedValueOnce(new Error('offline'));
  render(<MemoryRouter initialEntries={[{ pathname: '/arena/play', state: { arenaConfig: config } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Start' }));
  await play();
  expect(api.startInterview).toHaveBeenCalledTimes(2);
});

it('reads each question aloud once and records only after it has been read', async () => {
  let finishSpeaking;
  speech.speak.mockImplementation((source) => (source?.item === 'question-1'
    ? new Promise((resolve) => { finishSpeaking = resolve; })
    : Promise.resolve()));
  await open();
  expect(await screen.findByText('Interviewer is asking…')).toBeInTheDocument();
  expect(recorder.start).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Done answering/ })).not.toBeInTheDocument();
  await act(async () => finishSpeaking());
  expect(await screen.findByRole('button', { name: /Done answering/ })).toBeInTheDocument();
  expect(speech.playTurnChime).toHaveBeenCalledTimes(1);
  expect(recorder.start).toHaveBeenCalledTimes(1);
  expect(speech.speak.mock.calls.filter(([source]) => source?.item === 'question-1')).toHaveLength(1);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('submits the transcript through the existing Arena answer call and shows what was heard', async () => {
  await open(); await submit();
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.transcribeAnswer).toHaveBeenCalledWith('arena-id', 1, expect.any(Blob));
  expect(api.submitAnswer).toHaveBeenCalledWith('arena-id', expect.objectContaining({
    questionIndex: 1, questionText: question.question, candidateAnswer: SPOKEN, videoBlob: null,
  }));
  expect(api.nextQuestion).toHaveBeenCalledWith('arena-id', 'answer-id');
  expect(screen.getByText('What we heard')).toBeInTheDocument();
  expect(screen.getByText(`“${SPOKEN}”`)).toBeInTheDocument();
});

it('asks again when no speech is heard and never submits an empty answer', async () => {
  api.transcribeAnswer.mockRejectedValueOnce(Object.assign(new Error('No speech'), { status: 422 }));
  await open(); await speakAnswer();
  expect(await screen.findByText('No speech detected. Please try answering again.')).toBeInTheDocument();
  expect(speech.speak).toHaveBeenCalledWith({ phrase: 'no_speech' }, expect.any(String));
  expect(api.submitAnswer).not.toHaveBeenCalled();
  expect(api.nextQuestion).not.toHaveBeenCalled();
  // Listening again; the second attempt is heard and submitted.
  await speakAnswer();
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(recorder.start).toHaveBeenCalledTimes(2);
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
});

it('keeps the recording when transcription fails and retries with it', async () => {
  api.transcribeAnswer.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }));
  await open(); await speakAnswer();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.transcribeAnswer).toHaveBeenCalledTimes(2);
  expect(api.transcribeAnswer.mock.calls[1][2]).toBe(api.transcribeAnswer.mock.calls[0][2]);
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
});

it('lets the candidate type when the browser cannot record audio', async () => {
  recorder.start.mockReturnValue(null);
  await open();
  const box = await screen.findByRole('textbox', { name: 'Your answer' });
  fireEvent.change(box, { target: { value: 'Typed instead.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.submitAnswer).toHaveBeenCalledWith('arena-id', expect.objectContaining({ candidateAnswer: 'Typed instead.' }));
  expect(api.transcribeAnswer).not.toHaveBeenCalled();
});

it('stops recording when the candidate leaves the Arena', async () => {
  const cancel = vi.fn();
  recorder.start.mockImplementation(() => ({ stop: vi.fn(), cancel }));
  await open();
  await screen.findByRole('button', { name: /Done answering/ });
  cleanup();
  expect(cancel).toHaveBeenCalled();
  expect(speech.stopSpeaking).toHaveBeenCalled();
});

it('ends the spoken answer after three seconds of silence, as in the Standard Interview', async () => {
  await open();
  await screen.findByRole('button', { name: /Done answering/ });
  monitor.snap = { speaking: false, speechMs: 2500, silenceMs: 3200, elapsedMs: 6000, level: 0 };
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.transcribeAnswer).toHaveBeenCalledTimes(1);
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
});

it('does not allow the hint while the spoken answer is being processed', async () => {
  let finish;
  api.transcribeAnswer.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  api.useHint.mockResolvedValue({ hint: 'A hint', remaining_hints: 0 });
  await open(); await speakAnswer();
  expect(await screen.findByText('Processing your answer…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Use Hint' })).toBeDisabled();
  await act(async () => finish({ transcript: SPOKEN }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.useHint).not.toHaveBeenCalled();
  expect(api.submitAnswer).toHaveBeenCalledWith('arena-id', expect.objectContaining({ candidateAnswer: SPOKEN }));
});

it('offers typing when the server cannot transcribe, and sends typing signals', async () => {
  api.transcribeAnswer.mockRejectedValueOnce(Object.assign(new Error('Speech-to-text is turned off'), { status: 503 }));
  await open(); await speakAnswer();
  fireEvent.click(await screen.findByRole('button', { name: 'Type your answer instead' }));
  const box = await screen.findByRole('textbox', { name: 'Your answer' });
  fireEvent.keyDown(box, { key: 'S' });
  fireEvent.change(box, { target: { value: 'S' } });
  fireEvent.change(box, { target: { value: 'State is local data.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  const payload = api.submitAnswer.mock.calls[0][1];
  expect(payload.candidateAnswer).toBe('State is local data.');
  expect(payload.answerSignals.typing).toBeDefined();
  expect(api.transcribeAnswer).toHaveBeenCalledTimes(1);
});
