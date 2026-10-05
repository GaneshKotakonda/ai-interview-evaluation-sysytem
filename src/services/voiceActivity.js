// -------------------------------------------------------------
// Microphone level and voice-activity detection (Web Audio API)
// -------------------------------------------------------------
// Measures loudness (RMS) of the microphone about 20 times a second. The
// threshold adapts to the room: it tracks the background-noise floor and
// counts as speech only what is clearly above it. Nothing is recorded or
// sent anywhere by this module.
//
// const monitor = createVoiceMonitor(stream);
// monitor.snapshot() -> { level 0..1, speaking, speechMs, silenceMs, elapsedMs, noiseFloor }
// monitor.reset()    -> start a new answer (keeps the learned noise floor)
// monitor.stop()

const SAMPLE_MS = 50;
const MIN_THRESHOLD = 0.012;
const FLOOR_MULTIPLIER = 3;

export function createVoiceMonitor(stream) {
  const Context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  const audioTracks = stream?.getAudioTracks?.() || [];
  if (!Context || !audioTracks.length) return null;

  const context = new Context();
  const source = context.createMediaStreamSource(new MediaStream(audioTracks));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  let noiseFloor = 0.01;
  let level = 0;
  let speaking = false;
  let speechMs = 0;
  let lastVoiceAt = 0;
  let startedAt = performance.now();

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const threshold = Math.max(MIN_THRESHOLD, noiseFloor * FLOOR_MULTIPLIER);
    speaking = rms > threshold;
    if (speaking) {
      speechMs += SAMPLE_MS;
      lastVoiceAt = performance.now();
    } else {
      // Learn the room's background level only from non-speech samples.
      noiseFloor = noiseFloor * 0.98 + rms * 0.02;
    }
    level = Math.min(1, rms / 0.15);
  }, SAMPLE_MS);

  return {
    snapshot() {
      const now = performance.now();
      return {
        level,
        speaking,
        speechMs,
        silenceMs: speechMs > 0 ? now - lastVoiceAt : now - startedAt,
        elapsedMs: now - startedAt,
        noiseFloor,
      };
    },
    reset() {
      speechMs = 0;
      lastVoiceAt = 0;
      startedAt = performance.now();
    },
    stop() {
      clearInterval(timer);
      source.disconnect();
      context.close().catch(() => {});
    },
  };
}
