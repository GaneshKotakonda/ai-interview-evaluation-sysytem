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
      answer_mode: 'typed',
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

describe('speech, media and resume API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob(['v'])) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads audio for transcription with a matching extension', async () => {
    const { api } = await import('./api');
    await api.transcribeAnswer('iv-1', 2, new Blob(['a'], { type: 'audio/mp4' }));
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/interviews/iv-1/transcribe');
    expect(options.body.get('question_index')).toBe('2');
    expect(options.body.get('audio').name).toBe('q_2_audio.mp4');
  });

  it('sends per-answer vision metrics with a submission', async () => {
    const { api } = await import('./api');
    await api.submitAnswer('iv-1', { questionIndex: 1, questionText: 'Q', candidateAnswer: 'A', visionMetrics: { eyeContact: 80 } });
    expect(JSON.parse(fetch.mock.calls[0][1].body.get('vision_metrics'))).toEqual({ eyeContact: 80 });
  });

  it('loads interview state and owner-only media with the token', async () => {
    const { api, setAuthTokenProvider } = await import('./api');
    setAuthTokenProvider(async () => 'tok');
    URL.createObjectURL = vi.fn(() => 'blob:media');
    await api.getInterviewState('iv-1');
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/api/interviews/iv-1/state');
    expect(await api.getAnswerMediaUrl('iv-1', 3, 'audio')).toBe('blob:media');
    expect(fetch.mock.calls[1][0]).toBe('http://localhost:8000/api/interviews/iv-1/media/3?kind=audio');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });
});

describe('voice interview API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob(['x'])) }));
    URL.createObjectURL = vi.fn(() => 'blob:x');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends answer mode for Standard interviews only', async () => {
    const { api } = await import('./api');
    await api.startInterview('Role', 'uid', null, null, null, 5, 'standard', 'voice');
    expect(JSON.parse(fetch.mock.calls[0][1].body).answer_mode).toBe('voice');
    await api.startInterview('Role', 'uid', null, null, null, 6, 'game', 'voice');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('answer_mode');
  });

  it('sends the resume text only when there is one, and uploads resumes as multipart', async () => {
    const { api } = await import('./api');
    await api.startInterview('Role', 'uid', null, null, null, 5, 'standard', 'voice', { resumeText: 'Built APIs' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).resume_text).toBe('Built APIs');
    await api.startInterview('Role', 'uid', null, null, null, 5, 'standard', 'voice');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('resume_text');
    await api.parseResume(new File(['hello'], 'cv.txt', { type: 'text/plain' }));
    const [url, options] = fetch.mock.calls[2];
    expect(url).toMatch(/\/api\/resume\/parse$/);
    expect(options.body.get('file').name).toBe('cv.txt');
  });

  it('sends the answer position in the session recording', async () => {
    const { api } = await import('./api');
    await api.submitAnswer('iv', { questionIndex: 1, questionText: 'Q', candidateAnswer: 'A', recording: { part: 2, start: 30.5, end: 75 } });
    const body = fetch.mock.calls[0][1].body;
    expect([body.get('recording_part'), body.get('answer_start_seconds'), body.get('answer_end_seconds')]).toEqual(['2', '30.5', '75']);
  });

  it('uploads recording chunks and fetches speech and recordings', async () => {
    const { api } = await import('./api');
    await api.uploadRecordingChunk('iv', 1, 3, new Blob(['v'], { type: 'video/webm' }));
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/api/interviews/iv/recording');
    expect(fetch.mock.calls[0][1].body.get('seq')).toBe('3');
    await api.getSpeechUrl('iv', 'question-2');
    expect(fetch.mock.calls[1][0]).toBe('http://localhost:8000/api/interviews/iv/speech/question-2');
    await api.getPhraseUrl('speaker_test');
    expect(fetch.mock.calls[2][0]).toBe('http://localhost:8000/api/speech/speaker_test');
    await api.getRecordingUrl('iv', 2);
    expect(fetch.mock.calls[3][0]).toBe('http://localhost:8000/api/interviews/iv/recording/2');
  });
});

describe('proctoring API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports integrity events and completes early only when asked', async () => {
    const { api } = await import('./api');
    await api.reportProctoringEvents('iv', [{ id: 'e1', type: 'window_blur' }]);
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8000/api/interviews/iv/proctoring');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ events: [{ id: 'e1', type: 'window_blur' }] });
    await api.completeInterview('iv', {}, 60, true);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ ended_early: true, duration_seconds: 60 });
    await api.completeInterview('iv', {}, 60);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).not.toHaveProperty('ended_early');
  });
});
