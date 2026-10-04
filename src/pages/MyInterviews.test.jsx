// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MyInterviews from './MyInterviews';

const { getUserInterviews, deleteInterview } = vi.hoisted(() => ({
  getUserInterviews: vi.fn(), deleteInterview: vi.fn(),
}));
vi.mock('../services/api', () => ({ api: { getUserInterviews, deleteInterview } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'uid-1', displayName: 'Candidate' } }) }));

const HISTORY = [
  { id: 'a', role_title: 'Backend Engineer', interview_mode: 'standard', status: 'completed', overall_score: 80, created_at: '2026-09-25T10:00:00Z' },
  { id: 'b', role_title: 'Frontend Developer', interview_mode: 'game', status: 'completed', overall_score: 92, created_at: '2026-09-26T10:00:00Z' },
  { id: 'c', role_title: 'Data Engineer', interview_mode: 'standard', status: 'in_progress', overall_score: null, created_at: '2026-09-27T10:00:00Z' },
];

function renderPage() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><MyInterviews /></MemoryRouter>);
}
const rowNames = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);

beforeEach(() => { vi.clearAllMocks(); getUserInterviews.mockResolvedValue(HISTORY); });
afterEach(cleanup);

it('lists every session including incomplete ones, newest first', async () => {
  renderPage();
  await screen.findByText('Data Engineer');
  expect(rowNames()).toEqual(['Data EngineerStandard', 'Frontend DeveloperArena', 'Backend EngineerStandard']);
  expect(screen.getByText('3 sessions · 2 completed')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View result for Data Engineer' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View result for Frontend Developer' })).toHaveAttribute('href', '/arena/results?id=b');
});

it('filters by mode, status and search, and sorts by score', async () => {
  renderPage();
  await screen.findByText('Data Engineer');
  fireEvent.change(screen.getByLabelText('Filter by mode'), { target: { value: 'standard' } });
  expect(rowNames()).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'completed' } });
  expect(rowNames()).toEqual(['Backend EngineerStandard']);
  fireEvent.change(screen.getByLabelText('Filter by mode'), { target: { value: 'all' } });
  fireEvent.change(screen.getByLabelText('Sort interviews'), { target: { value: 'score' } });
  expect(rowNames()[0]).toBe('Frontend DeveloperArena');
  fireEvent.change(screen.getByPlaceholderText('Search by role'), { target: { value: 'nothing' } });
  expect(screen.getByText('No interviews match these filters.')).toBeInTheDocument();
});

it('deletes an interview after confirmation', async () => {
  deleteInterview.mockResolvedValue({ status: 'deleted' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Backend Engineer interview' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(() => expect(screen.queryByText('Backend Engineer')).not.toBeInTheDocument());
  expect(deleteInterview).toHaveBeenCalledWith('a');
});

it('keeps the row and shows an error when deletion fails', async () => {
  deleteInterview.mockRejectedValue(new Error('offline'));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Backend Engineer interview' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete/i);
  expect(screen.getAllByText('Backend Engineer').length).toBeGreaterThan(0);
});
