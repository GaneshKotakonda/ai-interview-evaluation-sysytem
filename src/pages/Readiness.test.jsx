// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Readiness from './Readiness';

vi.mock('../services/api', () => ({ api: { parseResume: vi.fn() } }));
vi.mock('../components/DeviceCheck', () => ({ default: () => <div>Device check</div> }));
vi.mock('../services/speech', () => ({ speak: vi.fn() }));
vi.mock('../services/voiceActivity', () => ({ NOISY_FLOOR: 0.1, createVoiceMonitor: vi.fn() }));

afterEach(() => { cleanup(); localStorage.clear(); });

const renderPage = () => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Readiness /></MemoryRouter>,
);

it('uploads a resume, shows it, and lets the candidate remove it', async () => {
  const { api } = await import('../services/api');
  api.parseResume.mockResolvedValue({ filename: 'cv.pdf', resume_text: 'Built a payments API in Python.' });
  renderPage();
  const input = await screen.findByLabelText(/Resume/);
  fireEvent.change(input, { target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByText('cv.pdf')).toBeInTheDocument();
  expect(screen.getByText('Tailored to resume')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove resume' }));
  await waitFor(() => expect(screen.queryByText('cv.pdf')).not.toBeInTheDocument());
});

it('shows the server message when the resume cannot be read', async () => {
  const { api } = await import('../services/api');
  api.parseResume.mockRejectedValue(Object.assign(new Error('x'), { status: 422, detail: 'The file is empty.' }));
  renderPage();
  const input = await screen.findByLabelText(/Resume/);
  fireEvent.change(input, { target: { files: [new File([''], 'cv.txt')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('The file is empty.');
});
