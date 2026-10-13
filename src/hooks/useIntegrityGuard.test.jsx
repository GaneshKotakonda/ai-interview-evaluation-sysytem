// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useIntegrityGuard } from './useIntegrityGuard';

const { api, captureFrame, exitFullscreen } = vi.hoisted(() => ({
  api: { reportProctoringEvents: vi.fn(), identitySnapshot: vi.fn() },
  captureFrame: vi.fn(), exitFullscreen: vi.fn(),
}));
vi.mock('../services/api', () => ({ api }));
vi.mock('../services/cameraSnapshot', () => ({ captureFrame }));
vi.mock('../services/proctoring', () => ({
  enterFullscreen: async () => true, exitFullscreen,
  startProctoring: () => ({ stop: vi.fn(), isAway: () => false }),
}));
vi.mock('../services/sceneMonitor', () => ({ startSceneMonitor: () => ({ stop: vi.fn() }) }));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(options = {}) {
  const turnRef = { current: 1 };
  let position = 12;
  const result = renderHook(() => useIntegrityGuard({
    videoRef: { current: {} }, turnRef,
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
