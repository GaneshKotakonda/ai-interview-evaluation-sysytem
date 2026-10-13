// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Reports from './Reports';

const { getUserReports } = vi.hoisted(() => ({ getUserReports: vi.fn() }));
vi.mock('../services/api', () => ({ api: { getUserReports } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'uid-1' } }) }));

function renderPage() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Reports /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('shows trend, averages, recurring feedback and links to each report', async () => {
  getUserReports.mockResolvedValue([
    {
      interview_id: 'new', role_title: 'Platform Engineer', overall_score: 84, answer_quality_score: 90,
      communication_score: 80, speech_fluency_score: 70, camera_engagement_score: null,
      strengths: ['Clear structure'], improvements: ['Add metrics'], evaluated_at: '2026-09-28T10:00:00Z',
    },
    {
      interview_id: 'old', role_title: 'Backend Engineer', overall_score: 70, answer_quality_score: 70,
      communication_score: 60, speech_fluency_score: 90, camera_engagement_score: null,
      strengths: ['Clear structure'], improvements: [], evaluated_at: '2026-09-20T10:00:00Z',
    },
  ]);
  renderPage();
  expect(await screen.findByRole('img', { name: /from 70 to 84/ })).toBeInTheDocument();
  expect(screen.getByText('+14 vs previous')).toBeInTheDocument();
  expect(screen.getByLabelText('Answer Quality: 80%')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Camera Engagement:/)).not.toBeInTheDocument();
  expect(screen.getByText('Clear structure')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open report for Backend Engineer' })).toHaveAttribute('href', '/report?id=old');
});

it('shows an empty state before the first report', async () => {
  getUserReports.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText('No reports yet')).toBeInTheDocument();
});

it('shows an error without fake data', async () => {
  getUserReports.mockRejectedValue(new Error('offline'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your reports/i);
});
