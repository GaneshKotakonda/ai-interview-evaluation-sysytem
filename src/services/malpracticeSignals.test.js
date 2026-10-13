import { describe, expect, it } from 'vitest';
import {
  createAnswerSignals, createAttentionTracker, createEpisode, createLipSyncTracker, createSweepDetector, createTypingTracker,
  gazeHorizontal, isVirtualDevice, mouthOpenness,
} from './malpracticeSignals';
import { countDetections, frameStats } from './sceneMonitor';

// Landmarks with the eye corners at x 0.30-0.40 and 0.60-0.70 and both irises at `iris`.
function landmarks(iris, lipGap = 0) {
  const points = [];
  points[33] = { x: 0.30, y: 0.4 };
  points[133] = { x: 0.40, y: 0.4 };
  points[362] = { x: 0.60, y: 0.4 };
  points[263] = { x: 0.70, y: 0.4 };
  points[468] = { x: 0.30 + iris * 0.1, y: 0.4 };
  points[473] = { x: 0.60 + iris * 0.1, y: 0.4 };
  points[13] = { x: 0.5, y: 0.6 };
  points[14] = { x: 0.5, y: 0.6 + lipGap };
  return points;
}

describe('face geometry', () => {
  it('measures iris position and lip gap', () => {
    expect(gazeHorizontal(landmarks(0.25))).toBeCloseTo(0.25);
    expect(gazeHorizontal(null)).toBeNull();
    expect(mouthOpenness(landmarks(0.5, 0.04))).toBeCloseTo(0.1);
  });
});

describe('reading sweeps', () => {
  it('counts slow drifts followed by quick returns, like reading lines', () => {
    const detector = createSweepDetector();
    let t = 0;
    for (let line = 0; line < 4; line += 1) {
      for (let step = 0; step <= 10; step += 1) detector.push((t += 100), 0.35 + step * 0.02);
      detector.push((t += 100), 0.36); // jump back to the start of the next line
    }
    expect(detector.sweeps).toBeGreaterThanOrEqual(3);
  });

  it('ignores jitter and slow looking around', () => {
    const detector = createSweepDetector();
    for (let i = 0; i < 200; i += 1) detector.push(i * 100, 0.5 + 0.01 * Math.sin(i));
    for (let i = 0; i < 100; i += 1) detector.push(20000 + i * 100, 0.5 + 0.15 * Math.sin(i / 15));
    expect(detector.sweeps).toBe(0);
  });
});

describe('lip sync', () => {
  it('triggers once after five seconds of speech with still lips', () => {
    const tracker = createLipSyncTracker();
    const triggers = [];
    for (let t = 0; t <= 6000; t += 100) {
      triggers.push(tracker.push(t, { voiced: true, facePresent: true, mouth: 0.05 }).triggered);
    }
    expect(triggers.filter(Boolean)).toHaveLength(1);
    expect(tracker.summary().voiced_mouth_still_ms).toBeGreaterThan(5000);
  });

  it('does not trigger while the lips move with the speech', () => {
    const tracker = createLipSyncTracker();
    let triggered = false;
    for (let t = 0; t <= 8000; t += 100) {
      triggered ||= tracker.push(t, { voiced: true, facePresent: true, mouth: 0.05 + 0.1 * ((t / 100) % 2) }).triggered;
    }
    expect(triggered).toBe(false);
  });
});

describe('episodes', () => {
  it('starts after the hold time and ends after the clear time', () => {
    const episode = createEpisode({ startAfterMs: 1000, endAfterMs: 2000 });
    expect(episode.update(0, true)).toBeNull();
    expect(episode.update(1000, true)).toBe('start');
    expect(episode.update(1500, false)).toBeNull();
    expect(episode.update(3600, false)).toBe('end');
  });
});

describe('typing', () => {
  it('flags large insertions and untrusted input', () => {
    const typing = createTypingTracker();
    typing.keydown({ key: 'a' });
    expect(typing.input({ isTrusted: true }, 1)).toBe(false);
    expect(typing.input({ isTrusted: true }, 60)).toBe(true);
    expect(typing.input({ isTrusted: false }, 1)).toBe(true);
    expect(typing.summary(61)).toEqual(expect.objectContaining({ keystrokes: 1, largest_insert: 60, untrusted_inputs: 1 }));
  });
});

describe('answer signals', () => {
  it('records latency to first speech and gaze while speaking', () => {
    const signals = createAnswerSignals({ voiceMode: true, now: 0 });
    signals.frame({ t: 0, facePresent: true, gazeX: 0.5, lookingAway: false, mouth: 0.1, voiced: false });
    signals.frame({ t: 4000, facePresent: true, gazeX: 0.5, lookingAway: true, mouth: 0.2, voiced: true });
    signals.frame({ t: 4400, facePresent: true, gazeX: 0.5, lookingAway: true, mouth: 0.1, voiced: true });
    const summary = signals.summary(10);
    expect(summary.latency_seconds).toBe(4);
    expect(summary.gaze.offscreen_ms).toBeGreaterThan(0);
    expect(summary.typing).toBeUndefined();
  });
});

describe('devices and scene', () => {
  it('recognises virtual cameras and microphones', () => {
    expect(isVirtualDevice('OBS Virtual Camera')).toBe(true);
    expect(isVirtualDevice('CABLE Output (VB-Audio Virtual Cable)')).toBe(true);
    expect(isVirtualDevice('Integrated Camera (04f2:b6dd)')).toBe(false);
    expect(isVirtualDevice('OBSBOT Tiny 2')).toBe(false);
  });

  it('counts confident detections', () => {
    const counts = countDetections({ detections: [
      { categories: [{ categoryName: 'person', score: 0.9 }] },
      { categories: [{ categoryName: 'person', score: 0.3 }] },
      { categories: [{ categoryName: 'cell phone', score: 0.6 }] },
    ] });
    expect(counts).toEqual({ persons: 1, phones: 1, books: 0 });
  });

  it('measures brightness and frame change', () => {
    const dark = new Uint8ClampedArray(16).fill(5);
    const first = frameStats(dark, null);
    expect(first.luminance).toBeCloseTo(5);
    expect(first.diff).toBeNull();
    expect(frameStats(dark, first.values).diff).toBe(0);
  });
});

describe('attention tracker', () => {
  const looking = { facePresent: true, eyeContact: true, headCentered: true };
  const away = { facePresent: true, eyeContact: false, headCentered: true };
  const missing = { facePresent: false, eyeContact: false, headCentered: false };
  const run = (tracker, observation, fromMs, toMs, step = 100) => {
    const results = [];
    for (let t = fromMs; t <= toMs; t += step) results.push(tracker.update(t, observation));
    return results;
  };

  it('does not warn when attention returns before 3 s', () => {
    const tracker = createAttentionTracker();
    expect(run(tracker, away, 0, 2900).every((r) => !r.warn)).toBe(true);
    expect(tracker.update(3000, looking).warn).toBeNull();
  });

  it('warns after 3 s of looking away', () => {
    const tracker = createAttentionTracker();
    const warns = run(tracker, away, 0, 3000).filter((r) => r.warn);
    expect(warns).toHaveLength(1);
    expect(warns[0].warn).toBe('look_at_screen');
  });

  it('resets the timer when the gaze returns', () => {
    const tracker = createAttentionTracker();
    const all = [
      ...run(tracker, away, 0, 2000),
      ...run(tracker, looking, 2100, 2500),
      ...run(tracker, away, 2600, 4600),
    ];
    expect(all.some((r) => r.warn)).toBe(false);
  });

  it('limits warnings by the cooldown and logs one episode', () => {
    const tracker = createAttentionTracker();
    const results = run(tracker, away, 0, 60000);
    expect(results.filter((r) => r.warn).length).toBeLessThanOrEqual(Math.ceil(60 / 6));
    expect(results.filter((r) => r.episodeStart)).toHaveLength(1);
  });

  it('starts a new episode only after attention returned, and clears at once', () => {
    const tracker = createAttentionTracker();
    run(tracker, away, 0, 3000);
    expect(tracker.update(3100, looking).clear).toBe(true);
    const second = run(tracker, away, 10000, 13000);
    expect(second.filter((r) => r.episodeStart)).toHaveLength(1);
  });

  it('asks to show the face after 3 s without one, with no integrity episode', () => {
    const tracker = createAttentionTracker();
    const warns = run(tracker, missing, 0, 3000).filter((r) => r.warn);
    expect(warns.map((r) => r.warn)).toEqual(['show_face']);
    expect(warns[0].episodeStart).toBe(false);
  });
});
