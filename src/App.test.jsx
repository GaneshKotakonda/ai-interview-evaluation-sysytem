// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
const { auth } = vi.hoisted(() => ({ auth: { user: null, loading: false } }));
vi.mock('./services/api', () => ({ api: { startInterview: vi.fn().mockResolvedValue({ interview_id: 'game', interview_mode: 'game', current_turn: 1, max_turns: 6, question: { index: 1, question: 'First challenge', difficulty: 'medium' } }) } }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
afterEach(cleanup);
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function open(path) {
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /><Location /></MemoryRouter>);
}
it.each(['/arena', '/arena/play', '/arena/results'])('protects %s when signed out', (path) => {
  auth.user = null;
  open(path);
  expect(screen.getByTestId('location')).toHaveTextContent('/login');
});
it('opens Arena in the authenticated layout with working navigation', async () => {
  auth.user = { uid: 'candidate', displayName: 'Candidate' };
  open('/arena');
  expect(screen.getByRole('heading', { name: 'Interview Arena' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Start Interview' })).toHaveAttribute('href', '/readiness');
  expect(screen.getByRole('link', { name: 'Interview Arena' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Start Arena Challenge' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/arena/play');
  // Ranked play opens on its own start screen, without the sidebar (focus mode).
  expect(await screen.findByRole('button', { name: /Start Ranked Arena/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Interview Arena' })).not.toBeInTheDocument();
});
