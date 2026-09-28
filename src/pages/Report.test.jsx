// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Report from './Report';
vi.mock('../services/api', () => ({ api: { getReport: vi.fn().mockResolvedValue({ overall_score: 80, interview_id: 'current' }) } }));
afterEach(() => { cleanup(); localStorage.clear(); });
it('shows the current interview journey with difficulty, follow-up and feedback', async () => {
  localStorage.setItem('current-interview-id', 'current');
  localStorage.setItem('ai-interview-progress', JSON.stringify({ interviewId: 'current', responses: [
    { index: 1, question: 'Design an API', difficulty: 'medium', completed: true, evaluation: { answer_quality_score: 90, feedback: 'Clear design' } },
    { index: 2, question: 'Explain tradeoffs', difficulty: 'hard', is_follow_up: true, completed: true },
  ] }));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  await screen.findByText('Adaptive Interview Journey');
  expect(screen.getByText('Design an API')).toBeInTheDocument();
  expect(screen.getByText('Hard')).toBeInTheDocument();
  expect(screen.getByText('AI Follow-up')).toBeInTheDocument();
  expect(screen.getByText('Technical score: 90/100')).toBeInTheDocument();
  expect(screen.getByText('Clear design')).toBeInTheDocument();
});
it('does not show a journey saved for another interview', async () => {
  localStorage.setItem('current-interview-id', 'current');
  localStorage.setItem('ai-interview-progress', JSON.stringify({ interviewId: 'old', responses: [{ question: 'Old question', completed: true }] }));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  await screen.findByText('Interview Performance Report');
  expect(screen.queryByText('Old question')).not.toBeInTheDocument();
});
