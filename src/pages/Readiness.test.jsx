// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Readiness from './Readiness';

vi.mock('../services/api', () => ({ api: { parseResume: vi.fn() } }));
vi.mock('../components/DeviceCheck', () => ({ default: () => <div>Device check</div> }));
vi.mock('../services/speech', () => ({ speak: vi.fn().mockResolvedValue() }));
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

it('lets the candidate choose a male or female interviewer voice and remembers it', async () => {
  renderPage();
  const female = await screen.findByRole('radio', { name: /Female/ });
  const male = screen.getByRole('radio', { name: /Male/ });
  expect(female).toBeChecked();
  fireEvent.click(male);
  expect(male).toBeChecked();
  expect(localStorage.getItem('interviewer-voice')).toBe('male');
  fireEvent.click(female);
  expect(localStorage.getItem('interviewer-voice')).toBe('female');
});

it('lets the candidate choose an American or British accent and remembers it', async () => {
  renderPage();
  const american = await screen.findByRole('radio', { name: 'American' });
  const british = screen.getByRole('radio', { name: 'British' });
  expect(american).toBeChecked();
  fireEvent.click(british);
  expect(british).toBeChecked();
  expect(localStorage.getItem('interviewer-accent')).toBe('british');
  fireEvent.click(american);
  expect(localStorage.getItem('interviewer-accent')).toBe('american');
});

it('plays a sample of the chosen voice when it changes and from the sample button', async () => {
  const { speak } = await import('../services/speech');
  speak.mockClear();
  renderPage();
  fireEvent.click(await screen.findByRole('radio', { name: /Male/ }));
  await waitFor(() => expect(speak).toHaveBeenCalledWith({ phrase: 'voice_sample' }, expect.any(String)));
  expect(localStorage.getItem('interviewer-voice')).toBe('male'); // saved before the sample plays
  fireEvent.click(screen.getByRole('radio', { name: 'British' }));
  const button = await screen.findByRole('button', { name: 'Hear the British male voice' });
  speak.mockClear();
  fireEvent.click(button);
  await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
});
