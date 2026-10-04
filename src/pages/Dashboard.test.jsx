// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const { getUserInterviews } = vi.hoisted(() => ({ getUserInterviews: vi.fn() }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'firebase-user-abc123',
      email: 'candidate@example.com',
      displayName: 'Candidate Name',
    },
  }),
}));

vi.mock('../services/api', () => ({
  api: { getUserInterviews },
}));

function renderDashboard() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>,
  );
}

function statValue(label) {
  const statLabel = screen.getAllByText(label).find((element) => element.tagName === 'P');
  const card = statLabel.closest('article');
  return card.querySelectorAll('p')[1];
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates statistics and recent rows from real interview history', async () => {
    getUserInterviews.mockResolvedValue([
      {
        id: 'one',
        role_title: 'Backend Engineer',
        status: 'completed',
        duration_seconds: 420,
        overall_score: 80,
        created_at: '2026-09-25T10:00:00Z',
        completed_at: '2026-09-25T10:07:00Z',
      },
      {
        id: 'two',
        role_title: 'Platform Engineer',
        status: 'completed',
        duration_seconds: 360,
        overall_score: 90,
        created_at: '2026-09-26T10:00:00Z',
        completed_at: '2026-09-26T10:06:00Z',
      },
      {
        id: 'three',
        role_title: 'Frontend Engineer',
        status: 'in_progress',
        duration_seconds: 0,
        overall_score: null,
        created_at: '2026-09-27T10:00:00Z',
        completed_at: null,
      },
    ]);

    renderDashboard();

    expect(await screen.findByText('Backend Engineer')).toBeInTheDocument();
    expect(statValue('Total Interviews')).toHaveTextContent('3');
    expect(statValue('Average Score')).toHaveTextContent('85%');
    expect(statValue('Best Score')).toHaveTextContent('90%');
    expect(statValue('Completed Interviews')).toHaveTextContent('2');
    expect(screen.getByText('Platform Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Frontend Engineer')).not.toBeInTheDocument();
  });

  it('shows a friendly start action when there are no completed interviews', async () => {
    getUserInterviews.mockResolvedValue([]);

    renderDashboard();

    const emptyHeading = await screen.findByText(/complete your first interview/i);
    expect(emptyHeading).toBeInTheDocument();
    expect(within(emptyHeading.parentElement).getByRole('button', { name: /start interview/i })).toBeInTheDocument();
    expect(statValue('Average Score')).toHaveTextContent('—');
  });

  it('shows a backend error without substituting fake scores', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserInterviews.mockRejectedValue(new Error('offline'));

    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load.*history/i);
    expect(screen.queryByText('82%')).not.toBeInTheDocument();
  });
});

it.each([['Start Standard Interview', '/readiness'], ['Enter Interview Arena', '/arena']])('routes %s to its own experience', async (label, path) => {
  getUserInterviews.mockResolvedValue([]);
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/" element={<Dashboard />} /><Route path={path} element={<p>Destination {path}</p>} />
  </Routes></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Standard Interview' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Interview Arena' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(await screen.findByText(`Destination ${path}`)).toBeInTheDocument();
});
it('links completed rows to their saved report or Arena results', async () => {
  getUserInterviews.mockResolvedValue([
    { id: 'std-1', role_title: 'Backend Engineer', interview_mode: 'standard', status: 'completed', overall_score: 80, created_at: '2026-09-25T10:00:00Z' },
    { id: 'game-1', role_title: 'Frontend Developer', interview_mode: 'game', status: 'completed', overall_score: 70, created_at: '2026-09-24T10:00:00Z' },
  ]);
  renderDashboard();
  expect(await screen.findByRole('link', { name: 'View result for Backend Engineer' })).toHaveAttribute('href', '/report?id=std-1');
  expect(screen.getByRole('link', { name: 'View result for Frontend Developer' })).toHaveAttribute('href', '/arena/results?id=game-1');
});
