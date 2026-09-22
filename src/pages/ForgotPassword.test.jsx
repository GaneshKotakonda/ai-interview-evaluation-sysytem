// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const authState = {
  user: null,
  loading: false,
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

afterEach(cleanup);

describe('forgot password route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a password-reset form to signed-out users', () => {
    render(
      <MemoryRouter
        initialEntries={['/forgot-password']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('is reachable from the login form', () => {
    render(
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('sends a reset email and confirms the request', async () => {
    authState.resetPassword.mockResolvedValue(undefined);
    render(
      <MemoryRouter
        initialEntries={['/forgot-password']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: '  candidate@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /if an account exists.*password reset link/i,
    );
    expect(authState.resetPassword).toHaveBeenCalledWith('candidate@example.com');
  });

  it('shows a useful message when Firebase cannot be reached', async () => {
    authState.resetPassword.mockRejectedValue({ code: 'auth/network-request-failed' });
    render(
      <MemoryRouter
        initialEntries={['/forgot-password']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'candidate@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /network error.*check your connection/i,
    );
  });

  it('does not reveal whether an email is registered', async () => {
    authState.resetPassword.mockRejectedValue({ code: 'auth/user-not-found' });
    render(
      <MemoryRouter
        initialEntries={['/forgot-password']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'unknown@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /if an account exists.*password reset link/i,
    );
  });
});
