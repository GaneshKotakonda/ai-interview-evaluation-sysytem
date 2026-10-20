// -------------------------------------------------------------
// Scene monitor: who and what is in view (MediaPipe Object Detector)
// -------------------------------------------------------------
// About once a second the camera frame is checked for:
//   * people (COCO "person"): more than one means someone else is present,
//     even when their face is turned away;
//   * a phone ("cell phone") or a book/notes ("book");
//   * a covered or dark camera, and a frozen image (a still picture fed
//     through a virtual camera never changes, a real camera always does).
// The model (EfficientDet-Lite0) loads from Google's model CDN on first use
// and runs entirely in the browser; frames are never uploaded by this module.
//
// const scene = startSceneMonitor({ video, onEvent });   video: element or () => element
// scene.latest()  -> { persons, phones, books, luminance, diff, ready }
// scene.stop()
// onEvent({ type, phase: 'start' | 'end', durationMs })
import { createEpisode } from './malpracticeSignals';

const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

const MIN_SCORE = { person: 0.5, 'cell phone': 0.4, book: 0.5 };
const DARK_LUMINANCE = 20;      // 0..255 average over the frame
const FROZEN_DIFF = 0.25;       // mean absolute change between frames, 0..255

let detectorPromise;

async function createDetector(delegate) {
  const { ObjectDetector, FilesetResolver } = await import(/* @vite-ignore */ VISION_CDN);
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    scoreThreshold: 0.35,
    maxResults: 10,
    categoryAllowlist: Object.keys(MIN_SCORE),
  });
}

function getDetector() {
  if (!detectorPromise) detectorPromise = createDetector('GPU').catch(() => createDetector('CPU'));
  return detectorPromise;
}

/** Count confident detections by kind. */
export function countDetections(result) {
  const counts = { persons: 0, phones: 0, books: 0 };
  for (const detection of result?.detections || []) {
    const best = detection.categories?.[0];
    if (!best || best.score < (MIN_SCORE[best.categoryName] ?? 1)) continue;
    if (best.categoryName === 'person') counts.persons += 1;
    if (best.categoryName === 'cell phone') counts.phones += 1;
    if (best.categoryName === 'book') counts.books += 1;
  }
  return counts;
}

/** Average luminance and mean change from the previous frame (RGBA bytes). */
export function frameStats(pixels, previous) {
  const count = pixels.length / 4;
  const values = new Float32Array(count);
  let luminance = 0;
  let diff = 0;
  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    values[p] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    luminance += values[p];
    if (previous) diff += Math.abs(values[p] - previous[p]);
  }
  return { luminance: luminance / count, diff: previous ? diff / count : null, values };
}

export function startSceneMonitor({ video: source, onEvent, intervalMs = 1000 }) {
  let stopped = false;
  let timer = null;
  let detector = null;
  let previous = null;
  const latest = { persons: 0, phones: 0, books: 0, luminance: null, diff: null, ready: false };
  const episodes = {
    phone_detected: createEpisode({ startAfterMs: 1500, endAfterMs: 3000 }),
    book_detected: createEpisode({ startAfterMs: 2000, endAfterMs: 5000 }),
    camera_blocked: createEpisode({ startAfterMs: 3000, endAfterMs: 2000 }),
    camera_frozen: createEpisode({ startAfterMs: 8000, endAfterMs: 2000 }),
  };
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const context = canvas?.getContext?.('2d', { willReadFrequently: true }) || null;
  if (canvas) {
    canvas.width = 32;
    canvas.height = 24;
  }

  const emit = (type, phase, now) => {
    if (!phase) return;
    onEvent?.({ type, phase, durationMs: phase === 'end' ? episodes[type].durationMs(now) : 0 });
  };

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const video = typeof source === 'function' ? source() : source;
    if (video && video.readyState >= 2 && video.videoWidth) {
      if (context) {
        try {
          context.drawImage(video, 0, 0, 32, 24);
          const stats = frameStats(context.getImageData(0, 0, 32, 24).data, previous);
          previous = stats.values;
          latest.luminance = stats.luminance;
          latest.diff = stats.diff;
          emit('camera_blocked', episodes.camera_blocked.update(now, stats.luminance < DARK_LUMINANCE), now);
          if (stats.diff !== null) {
            emit('camera_frozen', episodes.camera_frozen.update(now, stats.diff < FROZEN_DIFF), now);
          }
        } catch {
          // Frame not readable yet.
        }
      }
      if (detector) {
        try {
          Object.assign(latest, countDetections(detector.detectForVideo(video, Math.round(now))), { ready: true });
          emit('phone_detected', episodes.phone_detected.update(now, latest.phones > 0), now);
          emit('book_detected', episodes.book_detected.update(now, latest.books > 0), now);
        } catch (error) {
          console.warn('Object detection error', error);
        }
      }
    }
    timer = setTimeout(tick, intervalMs);
  };

  getDetector().then((loaded) => { detector = loaded; }).catch((error) => {
    console.warn('Object detection unavailable', error);
  });
  timer = setTimeout(tick, intervalMs);

  return {
    latest: () => ({ ...latest }),
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
