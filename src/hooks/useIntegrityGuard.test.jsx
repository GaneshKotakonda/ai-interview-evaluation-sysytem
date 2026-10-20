// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useIntegrityGuard } from './useIntegrityGuard';

const { api, captureFrame, exitFullscreen, proctor } = vi.hoisted(() => ({
  api: { reportProctoringEvents: vi.fn(), identitySnapshot: vi.fn() },
  captureFrame: vi.fn(), exitFullscreen: vi.fn(), proctor: { callbacks: null },
}));
vi.mock('../services/api', () => ({ api }));
vi.mock('../services/cameraSnapshot', () => ({ captureFrame }));
vi.mock('../services/proctoring', () => ({
  enterFullscreen: async () => true, exitFullscreen,
  startProctoring: (callbacks) => {
    proctor.callbacks = callbacks;
    return { stop: vi.fn(), isAway: () => false, isOutside: () => true, check: vi.fn() };
  },
}));
vi.mock('../services/sceneMonitor', () => ({ startSceneMonitor: () => ({ stop: vi.fn() }) }));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(options = {}) {
  const turnRef = { current: 1 };
  const videoRef = { current: {} }; // stable, like the page's useRef
  let position = 12;
  const result = renderHook(() => useIntegrityGuard({
    videoRef, turnRef,
    context: () => ({ part: 2, at: position }), ...options,
  })).result;
  act(() => result.current.configure({ interviewId: 'iv', maxViolations: 5, identity: { enabled: true, enrolled: true } }));
  return { result, turnRef, setPosition: (at) => { position = at; } };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.reportProctoringEvents.mockResolvedValue({});
  captureFrame.mockResolvedValue(new Blob(['photo']));
  exitFullscreen.mockResolvedValue();
});
afterEach(cleanup);

it('serializes overlapping flushes and drains observations added during a send', async () => {
  const send = deferred();
  api.reportProctoringEvents.mockReturnValueOnce(send.promise);
  const { result } = setup();
  act(() => result.current.queueEvent({ id: 'phone-1', type: 'phone_detected', question_index: 1 }));
  let barrier;
  act(() => {
    barrier = result.current.flushEvents({ required: true });
    result.current.queueEvent({ id: 'phone-1', type: 'phone_detected', question_index: 1, duration: 3.5 });
    result.current.queueEvent({ id: 'browser-2', type: 'window_blur', question_index: 1 });
    result.current.flushEvents();
  });
  expect(api.reportProctoringEvents).toHaveBeenCalledTimes(1);
  await act(async () => { send.resolve({}); await barrier; });
  expect(api.reportProctoringEvents.mock.calls.map(([, events]) => events.map(({ id, duration }) => [id, duration]))).toEqual([
    [['phone-1', null]], [['phone-1', 3.5], ['browser-2', null]],
  ]);
  await result.current.flushEvents({ required: true });
  expect(api.reportProctoringEvents).toHaveBeenCalledTimes(2);
});

it('drains every bounded batch before a required flush resolves', async () => {
  const send = deferred();
  api.reportProctoringEvents.mockReturnValueOnce(send.promise);
  const { result } = setup();
  act(() => {
    for (let i = 0; i < 121; i += 1) result.current.queueEvent({ id: `e${i}`, type: 'copy_blocked' });
  });
  const barrier = result.current.flushEvents({ required: true });
  await act(async () => { send.resolve({}); await barrier; });
  expect(api.reportProctoringEvents.mock.calls.map(([, events]) => events.length)).toEqual([1, 50, 50, 20]);
  expect(api.reportProctoringEvents.mock.calls.flatMap(([, events]) => events.map((e) => e.id))).toEqual(
    Array.from({ length: 121 }, (_, i) => `e${i}`),
  );
});

it('retains a failed batch with the same IDs and rejects the required barrier', async () => {
  const send = deferred();
  api.reportProctoringEvents.mockReturnValueOnce(send.promise);
  const { result } = setup();
  act(() => result.current.queueEvent({ id: 'phone-1', type: 'phone_detected', question_index: 1 }));
  const barrier = result.current.flushEvents({ required: true });
  await act(async () => {
    send.reject(new Error('offline'));
    await expect(barrier).rejects.toThrow('offline');
  });
  await act(async () => { await result.current.flushEvents({ required: true }); });
  expect(api.reportProctoringEvents.mock.calls[1][1]).toEqual(api.reportProctoringEvents.mock.calls[0][1]);
});

it('stops answer attribution at submission and keeps episode duration updates on the original answer', async () => {
  const { result, turnRef, setPosition } = setup();
  await act(async () => { await result.current.start(); });
  act(() => {
    result.current.beginAnswer(1);
    result.current.handleEpisode('phone_detected', 'start');
    result.current.endAnswer();
    setPosition(20);
    turnRef.current = 2;
    result.current.handleEpisode('book_detected', 'start');
    result.current.handleEpisode('phone_detected', 'end');
  });
  await act(async () => { await result.current.flushEvents({ required: true }); });
  const events = api.reportProctoringEvents.mock.calls.flatMap(([, batch]) => batch);
  expect(events.filter((e) => e.type === 'phone_detected').map((e) => e.question_index)).toEqual([1, 1]);
  expect(events.find((e) => e.type === 'book_detected').question_index).toBeNull();
  act(() => result.current.beginAnswer(2));
  expect(result.current.context()).toEqual({ question_index: 2, part: 2, at: 20 });
});

it('captures snapshot attribution before asynchronous camera work', async () => {
  const capture = deferred();
  captureFrame.mockReturnValueOnce(capture.promise);
  const { result, setPosition } = setup();
  await act(async () => { await result.current.start(); });
  let snapshot;
  act(() => { result.current.beginAnswer(1); snapshot = result.current.takeSnapshot(); });
  act(() => { result.current.endAnswer(); setPosition(30); result.current.beginAnswer(2); });
  await act(async () => { capture.resolve(new Blob(['photo'])); await snapshot; });
  expect(api.identitySnapshot).toHaveBeenCalledWith('iv', expect.any(Blob), { question_index: 1, part: 2, at: 12 });
});

it('completes termination triggered by an acknowledged batch without awaiting itself', async () => {
  const onTerminate = vi.fn();
  api.reportProctoringEvents.mockResolvedValue({ violations: 5 });
  const { result } = setup({ onTerminate });
  await act(async () => { await result.current.start(); });
  await act(async () => {
    result.current.queueEvent({ id: 'e', type: 'window_blur' });
    await result.current.flushEvents({ required: true });
  });
  expect(result.current.isTerminated()).toBe(true);
  expect(onTerminate).toHaveBeenCalledWith('violations');
  expect(exitFullscreen).toHaveBeenCalledTimes(1);
});

it('keeps each persistent warning until its own detector clears it, whatever the candidate clicks', async () => {
  const { result } = setup({ persistentWarnings: true });
  await act(async () => { await result.current.start(); });
  act(() => result.current.handleEpisode('phone_detected', 'start'));
  act(() => result.current.handleEpisode('extra_person', 'start'));
  expect(result.current.activeWarnings.map((w) => w.type)).toEqual(['phone_detected', 'extra_person']);
  expect(result.current.violations).toBe(2); // counted once each, as before

  act(() => result.current.dismissWarning()); // the candidate presses "Continue"
  expect(result.current.warning).toBeNull();
  expect(result.current.activeWarnings.map((w) => w.type)).toEqual(['phone_detected', 'extra_person']);

  act(() => result.current.handleEpisode('phone_detected', 'end')); // the phone is gone
  expect(result.current.activeWarnings).toEqual([
    { type: 'extra_person', message: 'Multiple people detected. Only the candidate should be visible.' },
  ]);
  act(() => result.current.handleEpisode('extra_person', 'end'));
  expect(result.current.activeWarnings).toEqual([]);
  expect(result.current.violations).toBe(2);
});

it('clears persistent warnings when the session stops, and never tracks them by default', async () => {
  const { result } = setup({ persistentWarnings: true });
  await act(async () => { await result.current.start(); });
  act(() => result.current.handleEpisode('phone_detected', 'start'));
  act(() => result.current.stop());
  expect(result.current.activeWarnings).toEqual([]);

  const plain = setup().result; // the Arena does not opt in
  await act(async () => { await plain.current.start(); });
  act(() => plain.current.handleEpisode('phone_detected', 'start'));
  expect(plain.current.persistentWarnings).toBe(false);
  expect(plain.current.activeWarnings).toEqual([]);
  expect(plain.current.warning).toMatchObject({ type: 'phone_detected' });
});

it('counts one background voice once, as "another voice" or as background noise', async () => {
  const { result } = setup({ persistentWarnings: true });
  await act(async () => { await result.current.start(); });
  act(() => result.current.beginAnswer(1));
  act(() => result.current.flagOnce('other_voice', { source: 'lip_sync' }));
  act(() => result.current.handleEpisode('background_sound', 'start'));
  expect(result.current.violations).toBe(1);
  expect(result.current.activeWarnings.map((w) => w.type)).toEqual(['background_sound']);

  act(() => result.current.beginAnswer(2));
  act(() => result.current.handleEpisode('background_sound', 'end'));
  act(() => result.current.handleEpisode('background_sound', 'start'));
  act(() => result.current.flagOnce('other_voice', { source: 'lip_sync' }));
  expect(result.current.violations).toBe(2);
  await waitForQueue();
  const types = api.reportProctoringEvents.mock.calls.flatMap(([, batch]) => batch.map((e) => e.type));
  expect(types.filter((t) => t === 'other_voice')).toHaveLength(2);      // both recorded
  expect(types.filter((t) => t === 'background_sound')).toHaveLength(3); // two starts and one end
});

async function waitForQueue() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const leave = (id) => ({ id, type: 'fullscreen_exit', types: new Set(['fullscreen_exit']), question_index: null });
const sentEvents = () => api.reportProctoringEvents.mock.calls.flatMap(([, events]) => events);

it('grace period: leaving before Question 1 is asked back, recorded and never counted', async () => {
  const onTerminate = vi.fn();
  const { result } = setup({ countFromFirstQuestion: true, onTerminate });
  await act(async () => { await result.current.start(); });
  expect(result.current.counting).toBe(false);
  for (const id of ['a', 'b', 'c', 'd']) {
    act(() => proctor.callbacks.onLeave(leave(id)));
    expect(result.current.away).not.toBeNull();
    act(() => proctor.callbacks.onReturn({ ...leave(id), types: ['fullscreen_exit'], duration: 1.5 }));
  }
  expect(result.current.violations).toBe(0);
  expect(result.current.awayLeft).toBeNull();
  expect(onTerminate).not.toHaveBeenCalled();
  await act(async () => { await result.current.flushEvents({ required: true }); });
  expect(new Set(sentEvents().map((e) => e.type))).toEqual(new Set(['before_start']));

  // From Question 1 on, leaving counts as before.
  act(() => result.current.startCounting());
  expect(result.current.counting).toBe(true);
  act(() => proctor.callbacks.onLeave(leave('e')));
  expect(result.current.violations).toBe(1);
});

it('grace period: problems seen before Question 1 are recorded as before_start, not counted', async () => {
  const { result } = setup({ countFromFirstQuestion: true });
  await act(async () => { await result.current.start(); });
  act(() => result.current.handleEpisode('phone_detected', 'start'));
  act(() => result.current.handleEpisode('phone_detected', 'end'));
  expect(result.current.violations).toBe(0);
  expect(result.current.warning).toBeNull();
  await act(async () => { await result.current.flushEvents({ required: true }); });
  expect(sentEvents().map((e) => [e.type, e.details?.type])).toEqual([['before_start', 'phone_detected'], ['before_start', 'phone_detected']]);
  act(() => result.current.startCounting());
  act(() => result.current.handleEpisode('phone_detected', 'start'));
  expect(result.current.violations).toBe(1);
});

it('without the grace option, leaving counts from the start (unchanged)', async () => {
  const { result } = setup();
  await act(async () => { await result.current.start(); });
  expect(result.current.counting).toBe(true);
  act(() => proctor.callbacks.onLeave(leave('x')));
  expect(result.current.violations).toBe(1);
});
