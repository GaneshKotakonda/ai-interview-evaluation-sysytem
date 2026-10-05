// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: { uploadRecordingChunk: vi.fn(), getSpeechUrl: vi.fn(), getPhraseUrl: vi.fn() },
}));
vi.mock('./api', () => ({ api }));

// Minimal MediaRecorder: the test emits chunks by calling `emit`.
let recorder;
class FakeRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, options) { recorder = this; this.options = options; this.state = 'inactive'; this.mimeType = 'video/webm'; }
  start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  emit(text) { this.ondataavailable({ data: new Blob([text]) }); }
}

describe('session recorder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('MediaRecorder', FakeRecorder);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads chunks in order every 10 s and waits for them on stop', async () => {
    const { startSessionRecording } = await import('./sessionRecorder');
    const uploads = [];
    api.uploadRecordingChunk.mockImplementation(async (...args) => { uploads.push(args.slice(0, 3)); });
    const session = startSessionRecording({ stream: {}, interviewId: 'iv', part: 2 });
    expect(recorder.timeslice).toBe(10000);
    recorder.emit('a');
    recorder.emit('b');
    await session.stop();
    expect(uploads).toEqual([['iv', 2, 0], ['iv', 2, 1]]);
    expect(session.pending()).toBe(0);
  });

  it('retries a failed upload instead of dropping it', async () => {
    vi.useFakeTimers();
    const { startSessionRecording } = await import('./sessionRecorder');
    const onUploadError = vi.fn();
    api.uploadRecordingChunk.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const session = startSessionRecording({ stream: {}, interviewId: 'iv', part: 1, onUploadError });
    recorder.emit('a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.uploadRecordingChunk).toHaveBeenCalledTimes(2);
    expect(api.uploadRecordingChunk.mock.calls[1][2]).toBe(0); // same chunk retried
    expect(onUploadError).toHaveBeenCalledTimes(1);
    const stopped = session.stop();
    await vi.runAllTimersAsync();
    await stopped;
    vi.useRealTimers();
  });
});

describe('speech', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('plays Piper audio and caches it for repeats', async () => {
    const plays = [];
    vi.stubGlobal('Audio', class {
      constructor(url) { this.url = url; plays.push(url); }
      play() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); }
      pause() {}
    });
    api.getSpeechUrl.mockResolvedValue('blob:q1');
    const { speak } = await import('./speech');
    await speak({ interviewId: 'iv', item: 'question-1' }, 'fallback');
    await speak({ interviewId: 'iv', item: 'question-1' }, 'fallback');
    expect(plays).toEqual(['blob:q1', 'blob:q1']);
    expect(api.getSpeechUrl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the browser voice when the server voice is unavailable', async () => {
    const spoken = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ name: 'English', lang: 'en-US' }],
      cancel: () => {},
      speak: (utterance) => { spoken.push(utterance.text); setTimeout(() => utterance.onend(), 0); },
    });
    api.getPhraseUrl.mockRejectedValue(Object.assign(new Error('503'), { status: 503 }));
    const { speak } = await import('./speech');
    await speak({ phrase: 'speaker_test' }, 'Browser voice test');
    expect(spoken).toEqual(['Browser voice test']);
  });
});
