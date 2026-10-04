// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Interview from './Interview';
const { api, navigate, user } = vi.hoisted(() => ({
  api: { startInterview: vi.fn(), submitAnswer: vi.fn(), nextQuestion: vi.fn() },
  navigate: vi.fn(), user: { uid: 'user-1' },
}));
vi.mock('../services/api', () => ({ api }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => navigate }));
vi.mock('../components/BehaviorMonitor', () => ({ default: () => <div>Behavior monitor</div> }));
const first = { index: 1, question: 'Design an API', difficulty: 'medium', is_follow_up: false };
const next = { index: 2, question: 'Explain API tradeoffs', difficulty: 'hard', is_follow_up: true };
let stopTrack;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  stopTrack = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{}], getAudioTracks: () => [{}] }),
  } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  URL.createObjectURL = vi.fn(() => 'blob:answer'); URL.revokeObjectURL = vi.fn();
  api.startInterview.mockResolvedValue({ interview_id: 'session-1', question: first, current_turn: 1, max_turns: 2 });
  api.submitAnswer.mockResolvedValue({ response_id: 'response-1', evaluation: { answer_quality_score: 90 } });
  api.nextQuestion.mockResolvedValue({ next_question: next, current_turn: 2, max_turns: 2, is_complete: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Interview /></MemoryRouter>);
  await screen.findByText(first.question);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use resource URLs and HTTP methods.' } });
}
it('uses public question fields and adaptive metadata, locking submitted turns', async () => {
  await open();
  expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
  expect(screen.getByText('Medium')).toBeInTheDocument();
  expect(screen.queryByText(/XP|Streak|Boss Round|Use Hint|Level 1/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByText(next.question);
  expect(api.nextQuestion).toHaveBeenCalledWith('session-1', 'response-1');
  expect(screen.getByText('Hard')).toBeInTheDocument();
  expect(screen.getByText('AI Follow-up')).toBeInTheDocument();
  expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.queryByRole('button', { name: /Previous/ })).not.toBeInTheDocument();
  expect(stopTrack).not.toHaveBeenCalled();
});
it('retries advancement without resubmitting the immutable answer', async () => {
  api.nextQuestion.mockRejectedValueOnce(new Error('offline'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByRole('button', { name: 'Retry Next Question' });
  expect(screen.getByRole('textbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Next Question' }));
  await screen.findByText(next.question);
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
  expect(api.nextQuestion).toHaveBeenCalledTimes(2);
});
it('keeps an unsuccessful submission on the same question and allows retry', async () => {
  api.submitAnswer.mockRejectedValueOnce(new Error('offline'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByRole('alert');
  expect(api.nextQuestion).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('Use resource URLs and HTTP methods.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Submission' }));
  await screen.findByText(next.question);
});
it('prevents duplicate clicks while showing both loading phases', async () => {
  let submit, advance;
  api.submitAnswer.mockImplementation(() => new Promise((resolve) => { submit = resolve; }));
  api.nextQuestion.mockImplementation(() => new Promise((resolve) => { advance = resolve; }));
  await open();
  const button = screen.getByRole('button', { name: 'Submit Answer' });
  fireEvent.click(button); fireEvent.click(button);
  await screen.findByText('Analyzing your response…');
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
  await act(async () => submit({ response_id: 'response-1' }));
  expect(screen.getByText('Preparing the next question…')).toBeInTheDocument();
  await act(async () => advance({ is_complete: true, next_question: null, current_turn: 1, max_turns: 1 }));
  expect(navigate).toHaveBeenCalledWith('/interview-complete');
  expect(JSON.parse(localStorage.getItem('ai-interview-progress')).responses[0].completed).toBe(true);
});
it('waits for final recorder data before uploading and retains the video on failure', async () => {
  let recorder;
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { recorder = this; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  api.submitAnswer.mockRejectedValueOnce(new Error('offline'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Start Answer Recording' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  expect(api.submitAnswer).not.toHaveBeenCalled();
  await act(async () => {
    recorder.ondataavailable({ data: new Blob(['final video']) }); recorder.onstop();
  });
  await screen.findByRole('button', { name: 'Retry Submission' });
  const blob = api.submitAnswer.mock.calls[0][1].videoBlob;
  expect(blob.size).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Retry Submission' }));
  await screen.findByText(next.question);
  expect(api.submitAnswer.mock.calls[1][1].videoBlob).toBe(blob);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:answer');
});
it('shows a recoverable start error instead of inventing offline questions', async () => {
  api.startInterview.mockRejectedValueOnce(new Error('offline'));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Interview /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Start' }));
  await screen.findByText(first.question);
});

it('completes all server-issued turns and saves the full journey without reusing video', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await screen.findByText(next.question);
  api.submitAnswer.mockResolvedValueOnce({ response_id: 'response-2', evaluation: { answer_quality_score: 75 } });
  api.nextQuestion.mockResolvedValueOnce({ is_complete: true, next_question: null, current_turn: 2, max_turns: 2 });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Consider consistency and latency.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/interview-complete'));
  expect(api.nextQuestion).toHaveBeenLastCalledWith('session-1', 'response-2');
  expect(api.submitAnswer).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ questionIndex: 2, questionText: next.question, videoBlob: null }));
  const progress = JSON.parse(localStorage.getItem('ai-interview-progress'));
  expect(progress.interviewId).toBe('session-1');
  expect(progress.responses).toHaveLength(2);
  expect(progress.responses.every((turn) => turn.completed)).toBe(true);
  expect(progress.responses[1].is_follow_up).toBe(true);
  expect(stopTrack).toHaveBeenCalled();
  expect(localStorage.getItem('ai-interview-duration')).not.toBeNull();
  // The mocked BehaviorMonitor never reports metrics, so no camera value may be
  // invented (previously a fake { eyeContact: 75 } was stored here).
  expect(localStorage.getItem('ai-interview-vision-metrics')).toBeNull();
});
