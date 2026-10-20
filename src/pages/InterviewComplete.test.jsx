// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InterviewComplete from './InterviewComplete';

const { completeInterview } = vi.hoisted(() => ({ completeInterview: vi.fn() }));

vi.mock('../services/api', () => ({
  api: { completeInterview },
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('InterviewComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('current-interview-id', 'interview-id');
    localStorage.setItem('ai-interview-duration', '420');
    localStorage.setItem('ai-interview-vision-metrics', JSON.stringify({ eyeContact: 80 }));
    completeInterview.mockResolvedValue({
      overall_score: 88,
      nlp_metrics: { total_fillers: 1 },
    });
  });

  it('passes the locally recorded duration to interview completion', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <InterviewComplete />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(completeInterview).toHaveBeenCalledWith(
        'interview-id',
        { eyeContact: 80 },
        420,
      );
    });
  });
});

it('counts saved adaptive turns and retries completion without enabling a failed report', async () => {
  localStorage.clear();
  localStorage.setItem('current-interview-id', 'interview-id');
  completeInterview.mockReset();
  completeInterview.mockResolvedValue({ interview_id: 'interview-id', overall_score: 88 });
  localStorage.setItem('ai-interview-progress', JSON.stringify({ interviewId: 'interview-id', responses: [{ completed: true }, { completed: true }, { completed: false }] }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  completeInterview.mockRejectedValueOnce(new Error('offline'));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InterviewComplete /></MemoryRouter>);
  expect(screen.getByText('2 questions')).toBeInTheDocument();
  const retry = await screen.findByRole('button', { name: 'Retry Report Generation' });
  expect(screen.getByRole('button', { name: 'View Evaluation Report' })).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole('button', { name: 'View Evaluation Report' })).toBeEnabled());
});
it('sends no invented camera value when the vision model produced no data', async () => {
  localStorage.clear();
  localStorage.setItem('current-interview-id', 'interview-id');
  completeInterview.mockReset();
  completeInterview.mockResolvedValue({ interview_id: 'interview-id', overall_score: 70 });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InterviewComplete /></MemoryRouter>);
  await waitFor(() => expect(completeInterview).toHaveBeenCalledWith('interview-id', {}, 0));
  expect(screen.getByText(/Not measured/)).toBeInTheDocument();
});

it('completes early when proctoring ended the interview', async () => {
  localStorage.clear();
  localStorage.setItem('current-interview-id', 'interview-id');
  localStorage.setItem('interview-ended-early', 'away');
  completeInterview.mockResolvedValue({ overall_score: 30, nlp_metrics: { total_fillers: 0 } });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InterviewComplete /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Interview ended early' })).toBeInTheDocument();
  expect(screen.getByText(/stayed outside the interview/)).toBeInTheDocument();
  await waitFor(() => expect(completeInterview).toHaveBeenCalledWith('interview-id', {}, 0, true, 'away'));
});

it('says plainly when the interview stopped before the first answer', async () => {
  localStorage.clear();
  localStorage.setItem('current-interview-id', 'interview-id');
  localStorage.setItem('interview-ended-early', 'violations');
  completeInterview.mockResolvedValue({
    overall_score: null, scored: false, completion: { answered: 0, total: 5 },
    nlp_metrics: { total_fillers: 0 }, integrity: { verdict: 'review', answers_zeroed: 0, answers_capped: 0 },
  });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InterviewComplete /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Interview stopped before the first answer' })).toBeInTheDocument();
  expect(screen.getByText(/Nothing was graded/)).toBeInTheDocument();
  expect(screen.getByText('Not scored')).toBeInTheDocument();
  expect(screen.getByText('None')).toBeInTheDocument();
  // No ticks for work that never ran, and no claim that answers were penalised.
  expect(screen.queryByText(/graded against the role/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Rubric similarity matched/)).not.toBeInTheDocument();
  expect(screen.queryByText(/some answers were penalised/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Start Again/ })).toBeInTheDocument();
});

it('marks unmeasured steps as skipped, not done', async () => {
  localStorage.clear();
  localStorage.setItem('current-interview-id', 'interview-id');
  completeInterview.mockResolvedValue({
    overall_score: 64, scored: true, completion: { answered: 3, total: 5 }, criteria_scores: { correctness: 70 },
    speech_metrics: { words_per_minute: 142, fillers_per_minute: 3 }, nlp_metrics: { total_fillers: 4 },
    integrity: { verdict: 'review', answers_zeroed: 1, answers_capped: 0 },
  });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><InterviewComplete /></MemoryRouter>);
  expect(await screen.findByText('3 of 5 answers graded against the role’s rubric')).toBeInTheDocument();
  expect(screen.getByText('142 words/min · 3 fillers/min')).toBeInTheDocument();
  expect(screen.getByText('Not measured')).toBeInTheDocument(); // no camera data stored
  expect(screen.getByText(/some answers were penalised/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeInTheDocument();
});
