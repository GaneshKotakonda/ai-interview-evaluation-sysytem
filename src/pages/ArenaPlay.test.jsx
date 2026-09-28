// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ArenaPlay from './ArenaPlay';
import { StrictMode } from 'react';
const { api, navigate } = vi.hoisted(() => ({ api: { startInterview: vi.fn(), submitAnswer: vi.fn(), nextQuestion: vi.fn(), useHint: vi.fn() }, navigate: vi.fn() }));
vi.mock('../services/api', () => ({ api }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user', email: 'user@test.com', displayName: 'Candidate' } }) }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => navigate }));
const config = { role_title: 'Frontend Developer', topic: 'React', job_description: 'React practice', interview_mode: 'game' };
const question = { index: 1, question: 'Explain React state', difficulty: 'medium', topic: 'State' };
const second = { index: 2, question: 'Explain render tradeoffs', difficulty: 'hard', topic: 'Rendering', is_follow_up: true };
const game = { base_xp: 88, difficulty_bonus: 10, streak_bonus: 0, hint_penalty: 0, xp_earned: 98, total_xp: 98, current_streak: 1, best_streak: 1, remaining_hints: 1 };
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  api.startInterview.mockResolvedValue({ interview_id: 'arena-id', interview_mode: 'game', current_turn: 1, max_turns: 6, question });
  api.submitAnswer.mockResolvedValue({ response_id: 'answer-id', evaluation: { answer_quality_score: 88, feedback: 'Clear explanation' } });
  api.nextQuestion.mockResolvedValue({ evaluation: { answer_quality_score: 88, feedback: 'Clear explanation' }, game, next_question: second, current_turn: 2, max_turns: 6, is_complete: false });
});
afterEach(cleanup);
async function open() {
  render(<MemoryRouter initialEntries={[{ pathname: '/arena/play', state: { arenaConfig: config } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter>);
  await screen.findByText(question.question);
}
function submit() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'State tracks changing component data.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
}
it('starts six game turns with identity and no camera requirement', async () => {
  await open();
  expect(api.startInterview).toHaveBeenCalledWith('Frontend Developer', 'user', 'React practice', 'user@test.com', 'Candidate', 6, 'game');
  expect(screen.getByText('Level 1')).toBeInTheDocument();
  expect(screen.getByText('XP 0')).toBeInTheDocument();
  expect(screen.getByText('Streak 0')).toBeInTheDocument();
  expect(screen.getByText('Medium')).toBeInTheDocument();
  expect(document.querySelector('video')).toBeNull();
});
it('holds the next question until the result is reviewed and uses returned XP', async () => {
  await open(); submit();
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(screen.getByText('98 XP')).toBeInTheDocument();
  expect(screen.getByText('Base Answer XP')).toBeInTheDocument();
  expect(screen.getByText('Streak 1')).toBeInTheDocument();
  expect(screen.queryByText(second.question)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next Challenge' }));
  expect(screen.getByText(second.question)).toBeInTheDocument();
  expect(screen.getByText('Level 2')).toBeInTheDocument();
  expect(screen.getByText('AI Follow-up')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  api.nextQuestion.mockResolvedValueOnce({ evaluation: { answer_quality_score: 60 }, game: { ...game, current_streak: 0, total_xp: 178 }, next_question: { ...second, index: 3 }, current_turn: 3, max_turns: 6 });
  submit();
  await screen.findByText('Streak 0');
});
it('retains an accepted answer and retries advancement only', async () => {
  api.nextQuestion.mockRejectedValueOnce(new Error('offline'));
  await open(); submit();
  await screen.findByRole('button', { name: 'Retry Advancement' });
  expect(screen.getByRole('textbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Advancement' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
  expect(api.nextQuestion).toHaveBeenLastCalledWith('arena-id', 'answer-id');
});
it('replays the exact payload after an uncertain submission and guards rapid clicks', async () => {
  let reject;
  api.submitAnswer.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await open(); submit();
  fireEvent.click(screen.getByRole('button', { name: 'Analyzing your answer…' }));
  expect(api.submitAnswer).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(screen.getByRole('textbox')).toHaveValue('State tracks changing component data.');
  expect(screen.getByRole('textbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry Submission' }));
  await screen.findByRole('heading', { name: 'Answer Result' });
  expect(api.submitAnswer.mock.calls[1][1]).toEqual(api.submitAnswer.mock.calls[0][1]);
});
it('shows Boss Round and finishes only after reviewing the final result', async () => {
  api.startInterview.mockResolvedValueOnce({ interview_id: 'arena-id', interview_mode: 'game', current_turn: 6, max_turns: 6, question: { ...question, index: 6, difficulty: 'expert', boss_round: true } });
  api.nextQuestion.mockResolvedValueOnce({ evaluation: { answer_quality_score: 88 }, game, is_complete: true, next_question: null });
  await open();
  expect(screen.getByRole('heading', { name: 'Boss Round' })).toBeInTheDocument();
  submit();
  await screen.findByRole('button', { name: 'Finish Arena' });
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
  await screen.findByText(question.question);
  expect(api.startInterview).toHaveBeenCalledTimes(1);
});
it('offers retry after a failed start', async () => {
  api.startInterview.mockRejectedValueOnce(new Error('offline'));
  render(<MemoryRouter initialEntries={[{ pathname: '/arena/play', state: { arenaConfig: config } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ArenaPlay /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Start' }));
  await screen.findByText(question.question);
  expect(api.startInterview).toHaveBeenCalledTimes(2);
});
