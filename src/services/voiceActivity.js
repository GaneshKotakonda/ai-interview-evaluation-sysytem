// -------------------------------------------------------------
// Microphone level and voice-activity detection (Web Audio API)
// -------------------------------------------------------------
// Twenty times a second the microphone spectrum is measured in the speech
// band (250-3500 Hz), so fans, hum and traffic rumble barely count. The
// background-noise level is the 15th percentile of the last six seconds:
// it follows a noisy room up and down, and it can never get "stuck" the way
// a floor learned only from quiet samples does (a room louder than the
// starting guess used to look like endless speech, so silence was never
// detected). Speech starts after two loud samples in a row and ends after
// a short hang-over, so single clicks and breaths are ignored. Nothing is
// recorded or sent anywhere by this module.
//
// const monitor = createVoiceMonitor(stream);
// monitor.snapshot() -> { level 0..1, speaking, speechMs, silenceMs, elapsedMs, noiseFloor }
// monitor.reset()    -> start a new answer (keeps the learned noise level)
// monitor.stop()

const SAMPLE_MS = 50;
const BAND_HZ = [250, 3500];
// Background level above which the readiness check calls the room noisy (about -60 dB).
export const NOISY_FLOOR = 0.001;

/**
 * Pure speech/silence classifier, fed one speech-band level per sample.
 * Exported for tests; createVoiceMonitor wires it to the microphone.
 */
export function createSpeechDetector({
  sampleMs = SAMPLE_MS,
  historyMs = 6000,
  percentile = 0.15,
  ratio = 2.2,
  minLevel = 0.0003, // about -70 dB: below this nothing counts as speech
  startFrames = 2,
  hangoverMs = 350,
} = {}) {
  const history = [];
  const maxHistory = Math.round(historyMs / sampleMs);
  let floor = minLevel;
  let loudRun = 0;
  let speaking = false;
  let lastLoudAt = -Infinity;
  let speechMs = 0;
  let lastVoiceAt = null;
  let startedAt = 0;
  let now = 0;

  const updateFloor = () => {
    const sorted = [...history].sort((a, b) => a - b);
    floor = Math.max(minLevel / ratio, sorted[Math.floor(sorted.length * percentile)] ?? minLevel);
  };

  return {
    push(level, time) {
      now = time;
      history.push(level);
      if (history.length > maxHistory) history.shift();
      if (history.length % 4 === 0 || history.length < 20) updateFloor();
      const loud = level > Math.max(minLevel, floor * ratio);
      loudRun = loud ? loudRun + 1 : 0;
      if (loud) lastLoudAt = time;
      if (!speaking && loudRun >= startFrames) speaking = true;
      if (speaking && time - lastLoudAt > hangoverMs) speaking = false;
      if (speaking) {
        speechMs += sampleMs;
        lastVoiceAt = time;
      }
      return speaking;
    },
    snapshot(time = now) {
      return {
        speaking,
        speechMs,
        silenceMs: lastVoiceAt === null ? time - startedAt : time - lastVoiceAt,
        elapsedMs: time - startedAt,
        noiseFloor: floor,
      };
    },
    reset(time = now) {
      speechMs = 0;
      lastVoiceAt = null;
      startedAt = time;
      loudRun = 0;
      speaking = false;
    },
  };
}

export function createVoiceMonitor(stream) {
  const Context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  const audioTracks = stream?.getAudioTracks?.() || [];
  if (!Context || !audioTracks.length) return null;

  const context = new Context();
  const source = context.createMediaStreamSource(new MediaStream(audioTracks));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const binHz = context.sampleRate / analyser.fftSize;
  const [low, high] = BAND_HZ.map((hz) => Math.round(hz / binHz));
  const detector = createSpeechDetector();
  detector.reset(performance.now());
  let level = 0;

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    level = Math.min(1, Math.sqrt(sum / samples.length) / 0.15); // for the level meter

    analyser.getFloatFrequencyData(spectrum); // decibels per bin
    let band = 0;
    for (let i = low; i <= high; i += 1) band += 10 ** (spectrum[i] / 20);
    detector.push(band / Math.max(1, high - low + 1), performance.now());
  }, SAMPLE_MS);

  return {
    snapshot() {
      return { level, ...detector.snapshot(performance.now()) };
    },
    reset() {
      detector.reset(performance.now());
    },
    stop() {
      clearInterval(timer);
      source.disconnect();
      context.close().catch(() => {});
    },
  };
}
