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
it('retries a failed result fetch without fabricated statistics', async () => {
  getArenaResults.mockRejectedValueOnce(new Error('offline'));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry Results' }));
  expect(await screen.findByText('640')).toBeInTheDocument();
});
