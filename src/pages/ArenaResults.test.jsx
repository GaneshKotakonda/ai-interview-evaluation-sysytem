// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ArenaResults from './ArenaResults';
const { getArenaResults } = vi.hoisted(() => ({ getArenaResults: vi.fn() }));
vi.mock('../services/api', () => ({ api: { getArenaResults } }));
beforeEach(() => {
  sessionStorage.clear(); sessionStorage.setItem('arena-interview-id', 'saved-arena');
  getArenaResults.mockReset().mockResolvedValue({ interview_mode: 'game', total_xp: 640, best_streak: 4, average_score: 81, highest_difficulty: 'expert', boss_score: 90, questions_completed: 6, strongest_areas: [{ topic: 'React state', score: 95 }], practice_areas: [{ topic: 'Rendering', score: 60 }], turns: [{ question_index: 1, feedback: 'Clear explanation', evaluation_source: 'gemini' }] });
});
afterEach(cleanup);
function open() {
  render(<MemoryRouter initialEntries={['/arena/results']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/arena/results" element={<ArenaResults />} />
    <Route path="/arena" element={<p>Arena setup destination</p>} />
    <Route path="/readiness" element={<p>Standard destination</p>} />
    <Route path="/dashboard" element={<p>Dashboard destination</p>} />
  </Routes></MemoryRouter>);
}
it('reconstructs results using the saved ID without route state', async () => {
  open();
  expect(await screen.findByText('640')).toBeInTheDocument();
  expect(getArenaResults).toHaveBeenCalledWith('saved-arena');
  expect(screen.getByText('Expert')).toBeInTheDocument();
  expect(screen.getByText('React state')).toBeInTheDocument();
  expect(screen.getByText('Rendering')).toBeInTheDocument();
  expect(screen.getByText('Clear explanation')).toBeInTheDocument();
});
it.each([['Play Again', 'Arena setup destination'], ['Try Standard Interview', 'Standard destination'], ['Back to Dashboard', 'Dashboard destination']])('routes %s without launching another game', async (action, destination) => {
  open(); await screen.findByText('640');
  fireEvent.click(screen.getByRole('link', { name: action }));
  expect(screen.getByText(destination)).toBeInTheDocument();
});
it('shows the rating change, rank and integrity penalty', async () => {
  getArenaResults.mockResolvedValueOnce({
    interview_mode: 'game', total_xp: 100, best_streak: 0, average_score: 20, highest_difficulty: 'easy', boss_score: null,
    questions_completed: 1, strongest_areas: [], practice_areas: [], turns: [], ended_early: true, end_reason: 'away',
    ratings: {
      overall: { label: 'Overall', rating: 1401, change: -99, rank: 7, total: 12, penalty: 65 },
      dsa: { label: 'Data Structures & Algorithms', rating: 1401, change: -99, rank: 3, total: 4, penalty: 65 },
    },
  });
  open();
  expect(await screen.findByRole('heading', { name: 'Rating' })).toBeInTheDocument();
  expect(screen.getAllByText('-99')).toHaveLength(2);
  expect(screen.getByText(/Rank #7 of 12 · includes −65 integrity penalty/)).toBeInTheDocument();
  expect(screen.getByText(/stayed outside it too long/)).toBeInTheDocument();
});
it('retries a failed result fetch without fabricated statistics', async () => {
  getArenaResults.mockRejectedValueOnce(new Error('offline'));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Results' }));
  expect(await screen.findByText('640')).toBeInTheDocument();
});
it('prefers an explicit ?id= over the last played session and labels the last turn as the Boss Round', async () => {
  getArenaResults.mockResolvedValueOnce({ interview_mode: 'game', max_turns: 6, total_xp: 10, best_streak: 0, average_score: 50, highest_difficulty: 'medium', boss_score: 50, questions_completed: 6, strongest_areas: [], practice_areas: [], turns: [{ question_index: 6, topic: 'Scaling', feedback: 'Final', evaluation_source: 'gemini' }] });
  render(<MemoryRouter initialEntries={['/arena/results?id=from-history']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/arena/results" element={<ArenaResults />} />
  </Routes></MemoryRouter>);
  expect(await screen.findByText('Boss Round · Scaling')).toBeInTheDocument();
  expect(getArenaResults).toHaveBeenCalledWith('from-history');
});
