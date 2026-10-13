import { api } from './api';

// -------------------------------------------------------------
// Whole-interview recording with chunked upload
// -------------------------------------------------------------
// Records camera + microphone for the entire interview and uploads a chunk
// about every 10 seconds, in order, retrying failed uploads. A crash or
// closed tab therefore loses at most a few seconds, and there is never one
// huge upload at the end. Each page load records a new "part".
//
// const session = startSessionRecording({ stream, interviewId, part });
// session.elapsedSeconds()  -> seconds since this part started (for answer markers)
// await session.stop()      -> stops and waits for every chunk to upload

const CHUNK_MS = 10000;
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const RETRY_DELAYS_MS = [1000, 3000, 8000, 15000];

export function startSessionRecording({ stream, interviewId, part, onUploadError }) {
  if (!stream || typeof MediaRecorder === 'undefined') return null;
  const mimeType = VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_000_000, // ~75 MB per 10 minutes
      audioBitsPerSecond: 64_000,
    });
  } catch {
    return null;
  }

  const startedAt = performance.now();
  const queue = [];
  let seq = 0;
  let uploading = false;
  let idleResolvers = [];

  const notifyIdle = () => {
    if (!uploading && queue.length === 0) {
      idleResolvers.forEach((resolve) => resolve());
      idleResolvers = [];
    }
  };

  const pump = async () => {
    if (uploading) return;
    uploading = true;
    while (queue.length) {
      const item = queue[0];
      let sent = false;
      for (let attempt = 0; !sent; attempt += 1) {
        try {
          await api.uploadRecordingChunk(interviewId, part, item.seq, item.blob);
          sent = true;
        } catch (error) {
          onUploadError?.(error);
          // A 409 means the server already has later chunks; skip this one.
          if (error?.status === 409 || error?.status === 413 || error?.status === 404) {
            sent = true;
            break;
          }
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      queue.shift();
    }
    uploading = false;
    notifyIdle();
  };

  recorder.ondataavailable = (event) => {
    if (event.data?.size > 0) {
      queue.push({ seq, blob: event.data });
      seq += 1;
      pump();
    }
  };
  recorder.start(CHUNK_MS);

  return {
    part,
    elapsedSeconds() {
      return Math.round((performance.now() - startedAt) / 10) / 100;
    },
    pending() {
      return queue.length;
    },
    stop({ timeoutMs = 60000 } = {}) {
      return new Promise((resolve) => {
        const finish = () => {
          const idle = new Promise((done) => { idleResolvers.push(done); notifyIdle(); });
          const timeout = new Promise((done) => setTimeout(done, timeoutMs));
          Promise.race([idle, timeout]).then(resolve);
        };
        if (recorder.state === 'inactive') {
          finish();
          return;
        }
        recorder.onstop = finish;
        recorder.stop();
      });
    },
  };
}
