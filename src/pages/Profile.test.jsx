// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Profile from './Profile';

const { getProfile, updateProfile, auth } = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  auth: {
    user: { uid: 'uid-1', displayName: 'Old Name', email: 'c@example.com', metadata: { creationTime: '2026-09-01T00:00:00Z' } },
    updateDisplayName: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
  },
}));
vi.mock('../services/api', () => ({ api: { getProfile, updateProfile } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

const PROFILE = {
  exists: true,
  stats: {
    total_interviews: 3, completed_interviews: 2, standard_interviews: 2, arena_sessions: 1,
    average_score: 85, best_score: 90, total_practice_seconds: 3900, last_interview_at: null,
  },
};

function renderPage() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Profile /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getProfile.mockResolvedValue(PROFILE);
});
afterEach(cleanup);

it('shows account info and practice statistics', async () => {
  renderPage();
  expect(screen.getByRole('heading', { name: 'Old Name' })).toBeInTheDocument();
  expect(await screen.findByText('85%')).toBeInTheDocument();
  expect(screen.getByText('1h 5m')).toBeInTheDocument();
  expect(getProfile).toHaveBeenCalledWith('uid-1');
});

it('saves the name to Firebase and the backend, and the default role locally', async () => {
  auth.updateDisplayName.mockResolvedValue();
  updateProfile.mockResolvedValue(PROFILE);
  renderPage();
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Name' } });
  fireEvent.change(screen.getByLabelText('Default target role'), { target: { value: 'Backend Engineer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
  expect(auth.updateDisplayName).toHaveBeenCalledWith('New Name');
  expect(updateProfile).toHaveBeenCalledWith('uid-1', { fullName: 'New Name', email: 'c@example.com' });
  expect(localStorage.getItem('target-role-title')).toBe('Backend Engineer');
});

it('validates password confirmation before calling Firebase', async () => {
  renderPage();
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpass1' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass1' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument();
  expect(auth.changePassword).not.toHaveBeenCalled();
});

it('reports a wrong current password', async () => {
  auth.changePassword.mockRejectedValue({ code: 'auth/invalid-credential' });
  renderPage();
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrongpass' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass1' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(await screen.findByText('Your current password is incorrect.')).toBeInTheDocument();
  expect(auth.changePassword).toHaveBeenCalledWith('wrongpass', 'newpass1');
});
