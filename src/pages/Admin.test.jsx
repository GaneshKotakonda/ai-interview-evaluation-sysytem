// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Admin from './Admin';
import Sidebar from '../components/Sidebar';

const { api } = vi.hoisted(() => ({ api: { getAdminOverview: vi.fn(), getAdminAccess: vi.fn() } }));
vi.mock('../services/api', () => ({ api }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u', displayName: 'Shafreed' }, logout: vi.fn() }) }));

const overview = {
  summary: { total_users: 4, new_users_7d: 4, active_24h: 3, active_7d: 4, active_30d: 4, in_progress_now: 1,
    sessions: 12, standard_sessions: 8, arena_sessions: 4, completed_sessions: 9 },
  users: [{ full_name: 'Ganesh', email: 'ganesh@example.com', created_at: '2026-10-17T10:00:00Z', sessions: 5, completed: 4, arena_sessions: 2, average_score: 71, last_active: new Date().toISOString() }],
  sessions: [{ full_name: 'Ganesh', email: 'ganesh@example.com', interview_mode: 'game', role_title: 'Frontend', status: 'in_progress', overall_score: null, created_at: '2026-10-18T10:00:00Z' }],
  daily: [],
};

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('shows the owner the usage overview', async () => {
  api.getAdminOverview.mockResolvedValue(overview);
  renderAt('/admin');
  expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument();
  expect(screen.getByText('Registered users')).toBeInTheDocument();
  expect(screen.getAllByText('Ganesh')).toHaveLength(2);
  expect(screen.getByRole('cell', { name: 'Arena' })).toBeInTheDocument();
  expect(screen.getByText('in progress')).toBeInTheDocument();
});

it('sends anyone else to the dashboard, as if the page did not exist', async () => {
  api.getAdminOverview.mockRejectedValue(Object.assign(new Error('Not found.'), { status: 404 }));
  renderAt('/admin');
  expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  expect(screen.queryByText('Registered users')).not.toBeInTheDocument();
});

it('shows the Usage link only to the owner', async () => {
  api.getAdminAccess.mockResolvedValue({ owner: false });
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
  await screen.findByText('Profile');
  await Promise.resolve();
  expect(screen.queryByText('Usage')).not.toBeInTheDocument();
  cleanup();
  api.getAdminAccess.mockResolvedValue({ owner: true });
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: /Usage/ })).toHaveAttribute('href', '/admin');
});
