import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('interview API contracts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends Firebase identity fields when starting an interview', async () => {
    const { api } = await import('./api');

    await api.startInterview(
      'Backend Engineer',
      'firebase-user-abc123',
      'Build APIs',
      'candidate@example.com',
      'Candidate Name',
    );

    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      firebase_uid: 'firebase-user-abc123',
      email: 'candidate@example.com',
      full_name: 'Candidate Name',
      role_title: 'Backend Engineer',
      job_description: 'Build APIs',
      max_turns: 5,
      interview_mode: 'standard',
    });
  });

  it('sends explicit game mode and six turns for Arena', async () => {
    const { api } = await import('./api');
    await api.startInterview('Frontend Developer', 'uid', 'React', 'email', 'Name', 6, 'game');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ interview_mode: 'game', max_turns: 6, firebase_uid: 'uid' });
  });

  it('requests persisted Arena results and hints for the specified turn', async () => {
    const { api } = await import('./api');
    await api.useHint('arena-id', 3);
    expect(fetch.mock.calls[0][0]).toContain('/arena-id/hint');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ current_turn: 3 });
    await api.getArenaResults('arena-id');
    expect(fetch.mock.calls[1][0]).toContain('/arena-id/arena-results');
  });

  it('sends duration seconds when completing an interview', async () => {
    const { api } = await import('./api');

    await api.completeInterview('interview-id', { eyeContact: 80 }, 420);

    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      vision_metrics: { eyeContact: 80 },
      duration_seconds: 420,
    });
  });

  it('advances with a response token and returns the adaptive result', async () => {
    const result = { next_question: null, current_turn: 5, max_turns: 5, is_complete: true };
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(result) });
    const { api } = await import('./api');
    expect(await api.nextQuestion('interview-id', 'response-id')).toEqual(result);
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/api/interviews/interview-id/next-question');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ response_id: 'response-id' });
  });

  it('propagates failed next-question calls', async () => {
    fetch.mockResolvedValue({ ok: false });
    const { api } = await import('./api');
    await expect(api.nextQuestion('interview-id')).rejects.toThrow('Failed to fetch next question');
  });

  it('URL-encodes Firebase UID when loading history', async () => {
    const { api } = await import('./api');

    await api.getUserInterviews('firebase/user+abc');

    expect(fetch.mock.calls[0][0]).toBe(
      'http://localhost:8000/api/interviews/user/firebase%2Fuser%2Babc',
    );
  });

  it('uses VITE_API_BASE_URL when configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');
    const { api } = await import('./api');

    await api.getUserInterviews('firebase-user');

    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.example.test/api/interviews/user/firebase-user',
    );
  });

  it('attaches HTTP status and server detail to failed requests', async () => {
    fetch.mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ detail: 'Interview is no longer active.' }) });
    const { api } = await import('./api');
    const error = await api.submitAnswer('interview-id', { questionIndex: 1, questionText: 'Q', candidateAnswer: 'A' }).catch((e) => e);
    expect(error.message).toBe('Failed to submit answer');
    expect(error.status).toBe(409);
    expect(error.detail).toBe('Interview is no longer active.');
  });

  it('URL-encodes interview ids in every interview path', async () => {
    const { api } = await import('./api');
    await api.getReport('a/b');
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/api/interviews/a%2Fb/report');
  });

  it('sends the Firebase ID token on JSON, multipart and GET requests', async () => {
    const { api, setAuthTokenProvider } = await import('./api');
    setAuthTokenProvider(async () => 'id-token-123');
    await api.startInterview('Role', 'uid');
    await api.submitAnswer('interview-id', { questionIndex: 1, questionText: 'Q', candidateAnswer: 'A' });
    await api.getProfile('uid');
    fetch.mock.calls.forEach(([, options]) => {
      expect(options.headers.Authorization).toBe('Bearer id-token-123');
    });
    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    // The browser must set the multipart boundary itself.
    expect(fetch.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
  });

  it('omits the Authorization header when signed out', async () => {
    const { api } = await import('./api');
    await api.getReport('interview-id');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('deletes by interview id only; ownership comes from the token', async () => {
    const { api } = await import('./api');
    await api.deleteInterview('interview-id');
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/api/interviews/interview-id');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  });
});
