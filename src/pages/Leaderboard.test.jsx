// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Leaderboard from './Leaderboard';

const { getLeaderboard } = vi.hoisted(() => ({ getLeaderboard: vi.fn() }));
vi.mock('../services/api', () => ({ api: { getLeaderboard } }));
afterEach(cleanup);

const categories = [{ id: 'overall', label: 'Overall' }, { id: 'dsa', label: 'Data Structures & Algorithms' }];

it('shows the overall ranking with my position, and switches category', async () => {
  getLeaderboard.mockImplementation(async (category) => ({
    category,
    categories,
    rows: category === 'overall'
      ? [{ rank: 1, name: 'Asha', rating: 1650, games: 4, best_rating: 1650, is_me: false },
        { rank: 2, name: 'Ravi', rating: 1540, games: 2, best_rating: 1560, is_me: true }]
      : [],
    me: category === 'overall' ? { rank: 2, total: 2, rating: 1540 } : { rank: null, total: 0, rating: null },
  }));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Leaderboard /></MemoryRouter>);
  expect(await screen.findByText('Asha')).toBeInTheDocument();
  expect(screen.getByText('#2')).toBeInTheDocument();
  expect(screen.getByText('(you)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Data Structures & Algorithms' }));
  await waitFor(() => expect(getLeaderboard).toHaveBeenLastCalledWith('dsa'));
  expect(await screen.findByText('No ranked players yet')).toBeInTheDocument();
});
