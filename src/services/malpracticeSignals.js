// -------------------------------------------------------------
// Malpractice signals measured in the browser (pure, testable helpers)
// -------------------------------------------------------------
// Fed by the camera analysis (~10 times a second) and the microphone level.
// Nothing here decides a penalty: the numbers go to the server with each
// answer (see backend/malpractice.py), and only clear live events — a voice
// while the candidate's lips are still, text that was never typed — are
// raised as warnings.
//
//   gazeHorizontal(landmarks)  0..1 iris position across the eye, or null
//   mouthOpenness(landmarks)   inner-lip gap / distance between the eyes
//   createSweepDetector()      counts "line return" eye movements (reading)
//   createLipSyncTracker()     speech heard while the lips are not moving
//   createEpisode()            debounced on/off condition (a phone in view…)
//   createAttentionTracker()   soft "look at the screen" reminders (never counted)
//   createTypingTracker()      keystrokes vs. text that appeared at once
//   createAnswerSignals()      everything above for one answer
//   isVirtualDevice(label)     OBS/ManyCam/virtual-audio style devices

// MediaPipe Face Landmarker (478 points with irises).
const RIGHT_EYE = { a: 33, b: 133, iris: 468 };
const LEFT_EYE = { a: 362, b: 263, iris: 473 };
const UPPER_LIP = 13;
const LOWER_LIP = 14;

function eyeRatio(landmarks, eye) {
  const a = landmarks[eye.a];
  const b = landmarks[eye.b];
  const iris = landmarks[eye.iris];
  if (!a || !b || !iris) return null;
  const width = Math.abs(b.x - a.x);
  if (width < 1e-4) return null;
  return (iris.x - Math.min(a.x, b.x)) / width;
}

export function gazeHorizontal(landmarks) {
  if (!landmarks) return null;
  const ratios = [eyeRatio(landmarks, RIGHT_EYE), eyeRatio(landmarks, LEFT_EYE)].filter((v) => v !== null);
  return ratios.length ? ratios.reduce((sum, v) => sum + v, 0) / ratios.length : null;
}

export function mouthOpenness(landmarks) {
  const top = landmarks?.[UPPER_LIP];
  const bottom = landmarks?.[LOWER_LIP];
  const left = landmarks?.[RIGHT_EYE.a];
  const right = landmarks?.[LEFT_EYE.b];
  if (!top || !bottom || !left || !right) return null;
  const eyes = Math.hypot(right.x - left.x, right.y - left.y);
  return eyes > 1e-4 ? Math.hypot(bottom.x - top.x, bottom.y - top.y) / eyes : null;
}

// Reading moves the eyes slowly along a line, then jumps back to the start
// of the next one. A sweep is a drift of at least `minDrift` lasting
// `minDriftMs`, followed within `maxReturnMs` by a jump back of most of it.
export function createSweepDetector({
  minDrift = 0.06, minDriftMs = 500, maxReturnMs = 350, returnRatio = 0.6, noise = 0.02,
} = {}) {
  let sweeps = 0;
  let start = null;
  let peak = null;
  let direction = 0;

  const restart = (t, x) => {
    start = { t, x };
    peak = { t, x };
    direction = 0;
  };

  return {
    push(t, x) {
      if (x === null || x === undefined || !Number.isFinite(x)) {
        start = null;
        return sweeps;
      }
      if (!start) {
        restart(t, x);
        return sweeps;
      }
      if (!direction) {
        if (Math.abs(x - start.x) >= noise) direction = Math.sign(x - start.x);
        peak = { t, x };
        return sweeps;
      }
      if ((x - peak.x) * direction >= 0) {
        peak = { t, x };
        return sweeps;
      }
      const drift = (peak.x - start.x) * direction;
      const back = (peak.x - x) * direction;
      if (drift >= minDrift && peak.t - start.t >= minDriftMs
          && back >= Math.max(0.05, drift * returnRatio) && t - peak.t <= maxReturnMs) {
        sweeps += 1;
        restart(t, x);
      } else if (back >= noise && t - peak.t > maxReturnMs) {
        restart(t, x); // a slow turn back is not a line return
      }
      return sweeps;
    },
    get sweeps() { return sweeps; },
  };
}

// Speech heard while the face is visible but the lips stay still: someone
// else is talking (a helper off camera, a recording, lip-syncing).
export function createLipSyncTracker({ windowMs = 800, stillRange = 0.03, minStreakMs = 5000 } = {}) {
  const samples = [];
  let last = null;
  let streak = 0;
  const totals = { voiced_ms: 0, voiced_mouth_still_ms: 0, longest_still_ms: 0 };

  return {
    push(t, { voiced, facePresent, mouth }) {
      const dt = last === null ? 0 : Math.min(500, Math.max(0, t - last));
      last = t;
      if (mouth !== null && mouth !== undefined) samples.push({ t, mouth });
      while (samples.length && t - samples[0].t > windowMs) samples.shift();
      if (!voiced || !facePresent || samples.length < 2) {
        if (!facePresent) streak = 0;
        return { streakMs: streak, triggered: false };
      }
      const values = samples.map((s) => s.mouth);
      const moving = Math.max(...values) - Math.min(...values) >= stillRange;
      totals.voiced_ms += dt;
      if (moving) {
        streak = 0;
      } else {
        totals.voiced_mouth_still_ms += dt;
        const before = streak;
        streak += dt;
        totals.longest_still_ms = Math.max(totals.longest_still_ms, streak);
        return { streakMs: streak, triggered: before < minStreakMs && streak >= minStreakMs };
      }
      return { streakMs: streak, triggered: false };
    },
    summary: () => ({ ...totals }),
  };
}

// Live reminders while the candidate looks away or leaves the frame. These
// are advisory only: they are not violations. The major `face_absent`
// episode (10 s) is separate and unchanged.
// Sound floor (same scale and value as NOISY_FLOOR in voiceActivity.js, which
// the readiness check uses) above which the room is not quiet. Sustained
// during an answer while the candidate is silent, it means music, a TV or
// other voices. The adaptive speech detector absorbs steady sound into its
// floor, so it never "hears" music by itself; this absolute check does.
export const BACKGROUND_SOUND_FLOOR = 0.001;

export const LOOK_AWAY_WARNING_MS = 3000;
export const FACE_MISSING_WARNING_MS = 3000;
export const GAZE_WARNING_COOLDOWN_MS = 6000;
export const GAZE_WARNING_DISPLAY_MS = 4000;

// update(t, observation) -> { warn: 'look_at_screen' | 'show_face' | null,
//                             clear: boolean, episodeStart: boolean }
// Time is passed in, so tests need no fake timers. A timer resets as soon as
// its condition stops; one continuous look-away is one episode, whose first
// warning alone carries episodeStart (one integrity event per episode).
export function createAttentionTracker({
  lookAwayMs = LOOK_AWAY_WARNING_MS,
  faceMissingMs = FACE_MISSING_WARNING_MS,
  cooldownMs = GAZE_WARNING_COOLDOWN_MS,
} = {}) {
  let awaySince = null;
  let missingSince = null;
  let lastWarnAt = -Infinity;
  let episodeLogged = false;
  let wasInattentive = false;

  return {
    update(t, observation) {
      const facePresent = Boolean(observation?.facePresent);
      // Strict: both signals must hold. Loosen to `||` if a real webcam gives false alarms.
      const attentive = Boolean(observation?.eyeContact && observation?.headCentered);
      const away = facePresent && !attentive;
      const missing = !facePresent;

      awaySince = away ? (awaySince ?? t) : null;
      missingSince = missing ? (missingSince ?? t) : null;
      if (!away) episodeLogged = false;

      const inattentive = away || missing;
      const clear = wasInattentive && !inattentive;
      wasInattentive = inattentive;

      let warn = null;
      if (t - lastWarnAt >= cooldownMs) {
        if (away && t - awaySince >= lookAwayMs) warn = 'look_at_screen';
        else if (missing && t - missingSince >= faceMissingMs) warn = 'show_face';
      }
      let episodeStart = false;
      if (warn) {
        lastWarnAt = t;
        if (warn === 'look_at_screen' && !episodeLogged) {
          episodeLogged = true;
          episodeStart = true;
        }
      }
      return { warn, clear, episodeStart };
    },
    reset() {
      awaySince = null;
      missingSince = null;
      lastWarnAt = -Infinity;
      episodeLogged = false;
      wasInattentive = false;
    },
  };
}

// A condition that must hold `startAfterMs` to start an episode and be
// absent `endAfterMs` to end it. update() returns 'start', 'end' or null.
export function createEpisode({ startAfterMs = 1000, endAfterMs = 3000 } = {}) {
  let since = null;
  let clearSince = null;
  let active = false;
  let startedAt = null;
  return {
    update(t, condition) {
      if (condition) {
        clearSince = null;
        if (since === null) since = t;
        if (!active && t - since >= startAfterMs) {
          active = true;
          startedAt = since;
          return 'start';
        }
      } else {
        since = null;
        if (active) {
          if (clearSince === null) clearSince = t;
          if (t - clearSince >= endAfterMs) {
            active = false;
            return 'end';
          }
        }
      }
      return null;
    },
    get active() { return active; },
    durationMs: (t) => (startedAt === null ? 0 : t - startedAt),
    reset() {
      since = null;
      clearSince = null;
      active = false;
      startedAt = null;
    },
  };
}

// Typed answers: count real keystrokes and the largest single insertion.
// Paste is blocked elsewhere, so a large insertion means text arrived from
// an auto-typer, a script or a dictation tool.
export const INJECTED_INSERT_CHARS = 25;

export function createTypingTracker() {
  const state = { keystrokes: 0, largest_insert: 0, untrusted_inputs: 0, first: null, last: null };
  return {
    keydown(event, now = Date.now()) {
      if (event?.key && (event.key.length === 1 || event.key === 'Enter')) state.keystrokes += 1;
      if (state.first === null) state.first = now;
      state.last = now;
    },
    // Characters typed in the code editor (it reports changes, not keys).
    typed(count, now = Date.now()) {
      state.keystrokes += Math.max(0, count || 0);
      if (state.first === null) state.first = now;
      state.last = now;
    },
    // Returns true when this input looks injected.
    input(nativeEvent, insertedChars) {
      if (nativeEvent && nativeEvent.isTrusted === false) state.untrusted_inputs += 1;
      const inserted = Math.max(0, insertedChars || 0);
      state.largest_insert = Math.max(state.largest_insert, inserted);
      return (nativeEvent && nativeEvent.isTrusted === false) || inserted >= INJECTED_INSERT_CHARS;
    },
    summary(chars) {
      return {
        keystrokes: state.keystrokes,
        chars,
        largest_insert: state.largest_insert,
        untrusted_inputs: state.untrusted_inputs,
        active_ms: state.first === null ? 0 : state.last - state.first,
      };
    },
  };
}

// One answer's signals, sent with the answer. Times are performance.now()
// milliseconds (the camera loop's clock).
export function createAnswerSignals({ voiceMode, now = performance.now() } = {}) {
  const startedAt = now;
  let latency = null;
  let last = null;
  const sweeps = createSweepDetector();
  const lips = createLipSyncTracker();
  const typing = createTypingTracker();
  const gaze = { speaking_ms: 0, offscreen_ms: 0, samples: 0 };

  return {
    typing,
    markActivity(t = performance.now()) {
      if (latency === null) latency = Math.max(0, (t - startedAt) / 1000);
    },
    // One camera frame. Returns the lip-sync state for live warnings.
    frame({ t, facePresent, gazeX, lookingAway, mouth, voiced }) {
      const dt = last === null ? 0 : Math.min(500, Math.max(0, t - last));
      last = t;
      if (voiced) this.markActivity(t);
      if (voiceMode && voiced && facePresent) {
        gaze.speaking_ms += dt;
        gaze.samples += 1;
        if (lookingAway) gaze.offscreen_ms += dt;
        sweeps.push(t, gazeX);
      }
      return lips.push(t, { voiced, facePresent, mouth });
    },
    summary(chars = 0) {
      const result = { lip_sync: lips.summary() };
      if (latency !== null) result.latency_seconds = Math.round(latency * 10) / 10;
      if (voiceMode) result.gaze = { ...gaze, sweeps: sweeps.sweeps, speaking_ms: Math.round(gaze.speaking_ms) };
      else result.typing = typing.summary(chars);
      return result;
    },
  };
}

const VIRTUAL_DEVICE = /virtual|manycam|snap camera|xsplit|droidcam|epoccam|iriun|\bcamo\b|vb-audio|voicemeeter|cable output|stereo mix|blackhole|soundflower|loopback/i;

export const isVirtualDevice = (label) => Boolean(label) && VIRTUAL_DEVICE.test(label);
