// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Report from './Report';
vi.mock('../services/api', () => ({ api: { getReport: vi.fn().mockResolvedValue({ overall_score: 80, interview_id: 'current' }), getAnswerMediaUrl: vi.fn().mockResolvedValue('blob:recording') } }));
afterEach(() => { cleanup(); localStorage.clear(); });
it('shows the current interview journey with difficulty, follow-up and feedback', async () => {
  localStorage.setItem('current-interview-id', 'current');
  localStorage.setItem('ai-interview-progress', JSON.stringify({ interviewId: 'current', responses: [
    { index: 1, question: 'Design an API', difficulty: 'medium', completed: true, evaluation: { answer_quality_score: 90, feedback: 'Clear design' } },
    { index: 2, question: 'Explain tradeoffs', difficulty: 'hard', is_follow_up: true, completed: true },
  ] }));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  await screen.findByText('Adaptive Interview Journey');
  expect(screen.getByText('Design an API')).toBeInTheDocument();
  expect(screen.getByText('Hard')).toBeInTheDocument();
  expect(screen.getByText('AI Follow-up')).toBeInTheDocument();
  expect(screen.getByText('Technical score: 90/100')).toBeInTheDocument();
  expect(screen.getByText('Clear design')).toBeInTheDocument();
});
it('does not show a journey saved for another interview', async () => {
  localStorage.setItem('current-interview-id', 'current');
  localStorage.setItem('ai-interview-progress', JSON.stringify({ interviewId: 'old', responses: [{ question: 'Old question', completed: true }] }));
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  await screen.findByText('Interview Performance Report');
  expect(screen.queryByText('Old question')).not.toBeInTheDocument();
});
it('opens a saved report by ?id= using server turns and omits missing camera data', async () => {
  const { api } = await import('../services/api');
  api.getReport.mockResolvedValueOnce({
    interview_id: 'past', overall_score: 77, role_title: 'Data Engineer',
    scores: [{ label: 'Answer Quality', value: 80 }, { label: 'Camera Engagement', value: null }],
    turns: [{ index: 1, question: 'Explain partitioning', difficulty: 'expert', evaluation: { answer_quality_score: 70, evaluation_source: 'fallback' }, adaptation: { reason: 'Keep level' } }],
  });
  localStorage.setItem('current-interview-id', 'current');
  render(<MemoryRouter initialEntries={['/report?id=past']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  expect(await screen.findByText('Explain partitioning')).toBeInTheDocument();
  expect(api.getReport).toHaveBeenLastCalledWith('past');
  expect(screen.getByText(/for Data Engineer/)).toBeInTheDocument();
  expect(screen.getByText('Adaptation: Keep level')).toBeInTheDocument();
  expect(screen.getByText(/Approximate score/)).toBeInTheDocument();
  expect(screen.queryByText('Camera Engagement')).not.toBeInTheDocument();
});
it('shows criteria, delivery, score weights and per-turn speech details with playback', async () => {
  URL.revokeObjectURL = vi.fn(); // not implemented by jsdom
  const { api } = await import('../services/api');
  api.getReport.mockResolvedValueOnce({
    interview_id: 'v2', overall_score: 81, role_title: 'Backend Engineer',
    scores: [{ label: 'Answer Quality', value: 84 }],
    criteria_scores: { correctness: 88, completeness: 62, technical_depth: 75, relevance: 95 },
    speech_metrics: { answers_with_audio: 2, words_per_minute: 134, fillers_per_minute: 1.5, long_pauses: 1, delivery_score: 90 },
    vision_metrics: { answers_with_camera: 2, eyeContact: 82, facePresence: 97, cameraFacing: 90, multipleFaceEvents: 0 },
    scoring: { version: 2, weights: { answer_quality: 0.4, communication: 0.25, camera_engagement: 0.2, speech_fluency: 0.15 } },
    turns: [{ index: 1, question: 'Design a rate limiter', difficulty: 'medium', answer: 'Token bucket per key.', transcript_source: 'whisper',
      has_video: true, evaluation: { answer_quality_score: 84, criteria_scores: { correctness: 88, completeness: 62, technical_depth: 75, relevance: 95 } },
      speech_metrics: { words_per_minute: 134, filler_count: 2, long_pauses: 0 }, vision_metrics: { eyeContact: 82, facePresence: 97 } }],
  });
  render(<MemoryRouter initialEntries={['/report?id=v2']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  expect(await screen.findByText('Answer criteria')).toBeInTheDocument();
  expect(screen.getByLabelText('Completeness: 62%')).toBeInTheDocument();
  expect(screen.getByText('134 wpm', { selector: 'dd' })).toBeInTheDocument();
  expect(screen.getByText('How this score was calculated')).toBeInTheDocument();
  expect(screen.getByText('Speech fluency')).toBeInTheDocument();
  expect(screen.getByText('Spoken answer')).toBeInTheDocument();
  expect(screen.getByText('Token bucket per key.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
  await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', 'blob:recording'));
  expect(api.getAnswerMediaUrl).toHaveBeenCalledWith('v2', 1, 'video');
});
it('shows the integrity summary, event timeline and an ended-early notice', async () => {
  const { api } = await import('../services/api');
  api.getReport.mockResolvedValueOnce({
    interview_id: 'pr', overall_score: 40, role_title: 'Backend Engineer', ended_early: true,
    scores: [{ label: 'Answer Quality', value: 40 }],
    integrity: { level: 'flagged', violations: 5, time_away_seconds: 63.4, counts: { window_blur: 4, tab_hidden: 1, paste_blocked: 2 },
      multiple_face_events: 1, low_presence_answers: 0, ended_early: true },
    proctoring_events: [
      { event_type: 'window_blur', label: 'Switched to another window or app', major: true, question_index: 2, recording_part: 1, at_seconds: 75, duration_seconds: 12 },
      { event_type: 'paste_blocked', label: 'Paste blocked', major: false, question_index: 3, recording_part: 1, at_seconds: 130, duration_seconds: null },
    ],
    turns: [],
  });
  render(<MemoryRouter initialEntries={['/report?id=pr']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  expect(await screen.findByText('Integrity')).toBeInTheDocument();
  expect(screen.getByText('Flagged')).toBeInTheDocument();
  expect(screen.getByText('5×')).toBeInTheDocument();
  expect(screen.getByText('5× · 63 s')).toBeInTheDocument();
  expect(screen.getByText('Switched to another window or app')).toBeInTheDocument();
  expect(screen.getByText(/· 12 s/)).toBeInTheDocument();
  expect(screen.getByText(/ended early after repeated integrity warnings/)).toBeInTheDocument();
});

it('shows the verdict, identity evidence and per-answer penalties', async () => {
  const { api } = await import('../services/api');
  api.getIdentityImageUrl = vi.fn().mockResolvedValue('blob:image');
  api.getReport.mockResolvedValueOnce({
    interview_id: 'iv', overall_score: 0, role_title: 'Backend Engineer',
    scores: [{ label: 'Answer Quality', value: 30 }],
    integrity: {
      level: 'flagged', verdict: 'invalid', violations: 3, counts: { voice_mismatch: 2, extra_person: 1 },
      reasons: ['The candidate\'s identity could not be confirmed throughout the interview.'],
      answers_zeroed: 2, answers_capped: 1, score_before_integrity: 71,
      identity: { enrolled: true, voice_checks: { match: 3, mismatch: 2 }, face_checks: { match: 20, mismatch: 2 }, face_mismatch_events: 1 },
    },
    identity: { enrolled: true, photo: 'enroll.jpg', flagged_checks: [
      { id: 'c1', kind: 'face', verdict: 'mismatch', recording_part: 1, at_seconds: 95, image_name: 'check_c1.jpg' },
    ] },
    proctoring_events: [],
    turns: [{
      index: 1, question: 'Explain indexes', evaluation: { answer_quality_score: 85 },
      integrity: { action: 'zero', original_score: 85, adjusted_score: 0,
        flags: [{ code: 'voice_mismatch', label: 'Answered in a voice that does not match the candidate', severity: 'zero' }] },
    }],
  });
  render(<MemoryRouter initialEntries={['/report?id=iv']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  expect(await screen.findByText('Invalid')).toBeInTheDocument();
  expect(screen.getByText(/This interview is invalid/)).toBeInTheDocument();
  expect(screen.getByText('71')).toBeInTheDocument();
  expect(screen.getByText(/Voice matched in 3 of 5 spoken answers/)).toBeInTheDocument();
  expect(screen.getByText('Answered in a voice that does not match the candidate')).toBeInTheDocument();
  expect(screen.getByText(/Scored 0: another person/)).toBeInTheDocument();
  expect(screen.getByText('Technical score: 0/100')).toBeInTheDocument();
  await waitFor(() => expect(api.getIdentityImageUrl).toHaveBeenCalledWith('iv', 'check_c1.jpg'));
  expect(api.getIdentityImageUrl).toHaveBeenCalledWith('iv', 'enroll.jpg');
  expect(await screen.findByAltText('Enrolment photo')).toHaveAttribute('src', 'blob:image');
});
it('shows completion, the insufficient-responses notice and Speech Fluency "—" when everything was skipped', async () => {
  const { api } = await import('../services/api');
  api.getReport.mockResolvedValueOnce({
    interview_id: 'skipped', overall_score: 0, role_title: 'Backend Engineer', insufficient_responses: true,
    completion: { answered: 0, total: 5, skipped: 5, ratio: 0, rate_percent: 0 },
    scores: [{ label: 'Answer Quality', value: 0 }, { label: 'Communication', value: 0 },
      { label: 'Speech Fluency', value: null }, { label: 'Camera Engagement', value: 87 }],
    criteria_scores: { correctness: 0, completeness: 0, technical_depth: 0, relevance: 0 },
    turns: [{ index: 1, question: 'Explain REST', difficulty: 'medium', answer: 'skip',
      evaluation: { answer_quality_score: 0, evaluation_source: 'skipped' } }],
  });
  render(<MemoryRouter initialEntries={['/report?id=skipped']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
  expect(await screen.findByText('0 / 5')).toBeInTheDocument();
  expect(screen.getByText(/Insufficient substantive responses were provided/)).toBeInTheDocument();
  expect(screen.getByText('Speech Fluency').parentElement).toHaveTextContent('—');
  expect(screen.getByText('Camera Engagement')).toBeInTheDocument();
  expect(screen.queryByText('Answer criteria')).not.toBeInTheDocument();
  expect(screen.getByText('Skipped')).toBeInTheDocument();
});
