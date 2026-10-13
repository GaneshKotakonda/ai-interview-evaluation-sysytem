// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { detectForVideo, createFromOptions, forVisionTasks } = vi.hoisted(() => ({
  detectForVideo: vi.fn(), createFromOptions: vi.fn(), forVisionTasks: vi.fn(),
}));
vi.mock('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm', () => ({
  ObjectDetector: { createFromOptions }, FilesetResolver: { forVisionTasks },
}));

let scene;
let phones;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  phones = [];
  detectForVideo.mockImplementation(() => ({
    detections: phones.map((score) => ({ categories: [{ categoryName: 'cell phone', score }] })),
  }));
  forVisionTasks.mockResolvedValue({});
  createFromOptions.mockResolvedValue({ detectForVideo });
  let frame = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => { frame += 1; },
    // Bright changing frames prevent camera-dark/frozen events from sharing
    // these phone fixtures. No actual webcam or model/network is needed.
    getImageData: () => ({ data: new Uint8ClampedArray([frame % 2 ? 100 : 120, 100, 100, 255]) }),
  });
});

afterEach(() => {
  scene?.stop();
  scene = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function monitor(intervalMs = 100) {
  const { startSceneMonitor } = await import('./sceneMonitor');
  const events = [];
  scene = startSceneMonitor({
    video: () => ({ readyState: 2, videoWidth: 640 }),
    onEvent: (event) => events.push(event), ...(intervalMs === null ? {} : { intervalMs }),
  });
  await vi.dynamicImportSettled(); // finish the mocked detector load before observations
  return events;
}

it('confirms a phone only after 1500 ms of detections at or above 0.4 confidence', async () => {
  phones = [0.399];
  const events = await monitor();
  await vi.advanceTimersByTimeAsync(2000);
  expect(scene.latest()).toMatchObject({ ready: true, phones: 0 });
  expect(events).toEqual([]);

  phones = [0.4];
  await vi.advanceTimersByTimeAsync(100); // first qualifying observation at 2100
  expect(scene.latest().phones).toBe(1);
  await vi.advanceTimersByTimeAsync(1499);
  expect(events).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toEqual([{ type: 'phone_detected', phase: 'start', durationMs: 0 }]);
});

it('ignores a transient phone and requires a fresh sustained observation after it disappears', async () => {
  phones = [0.9];
  const events = await monitor();
  await vi.advanceTimersByTimeAsync(1400);
  phones = [];
  await vi.advanceTimersByTimeAsync(100);
  expect(events).toEqual([]);

  phones = [0.9];
  await vi.advanceTimersByTimeAsync(1500); // first seen at 1600; only 1400 ms sustained
  expect(events).toEqual([]);
  await vi.advanceTimersByTimeAsync(100);
  expect(events).toEqual([{ type: 'phone_detected', phase: 'start', durationMs: 0 }]);
});

it('emits one start per phone episode and an end with its duration after three seconds clear', async () => {
  phones = [0.8];
  const events = await monitor();
  await vi.advanceTimersByTimeAsync(5000);
  expect(events).toEqual([{ type: 'phone_detected', phase: 'start', durationMs: 0 }]);

  phones = [];
  await vi.advanceTimersByTimeAsync(3099); // clear starts at 5100; end is due at 8100
  expect(events).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toEqual([
    { type: 'phone_detected', phase: 'start', durationMs: 0 },
    { type: 'phone_detected', phase: 'end', durationMs: 8000 }, // first seen at 100, cleared at 8100
  ]);

  phones = [0.8];
  await vi.advanceTimersByTimeAsync(1600);
  expect(events[2]).toEqual({ type: 'phone_detected', phase: 'start', durationMs: 0 });
});

it('uses the default camera polling loop and stops observations when stopped', async () => {
  phones = [0.9];
  const events = await monitor(null);
  await vi.advanceTimersByTimeAsync(2000);
  expect(events).toEqual([]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toEqual([{ type: 'phone_detected', phase: 'start', durationMs: 0 }]);
  scene.stop();
  phones = [];
  await vi.advanceTimersByTimeAsync(5000);
  expect(events).toHaveLength(1);
});
