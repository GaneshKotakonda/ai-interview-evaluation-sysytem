// -------------------------------------------------------------
// Integrity guard: proctoring + malpractice detection for a session
// -------------------------------------------------------------
// Shared by the interview and the ranked Arena. It owns:
//   * fullscreen and "left the interview" detection (proctoring.js), with
//     the away limit: staying outside the page for maxAwaySeconds in one go
//     ends the session at once;
//   * the warning count (local events plus the server's identity events);
//     reaching maxViolations ends the session;
//   * live detection from camera frames (another person, no face, speech
//     while the lips are still) and the scene monitor (phone, book, covered
//     or frozen camera);
//   * identity snapshots every 20 s once the candidate is enrolled;
//   * sending every event to the server, in order, retrying failures.
//
// Every function reads refs, so callbacks created early never go stale.
// The page decides what "ending" means through onTerminate(reason), with
// reason "away" or "violations".
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { enterFullscreen, exitFullscreen, startProctoring } from '../services/proctoring';
import { startSceneMonitor } from '../services/sceneMonitor';
import { captureFrame } from '../services/cameraSnapshot';
import { BACKGROUND_SOUND_FLOOR, createAttentionTracker, createEpisode, GAZE_WARNING_DISPLAY_MS } from '../services/malpracticeSignals';

export const SNAPSHOT_EVERY_MS = 20000;
const AWAY_TICK_MS = 250;

export const WARNINGS = {
  extra_person: ['Another person is in view', 'You must take the interview alone. Ask anyone else to leave the room.'],
  phone_detected: ['A phone is in view', 'Phones are not allowed. Put it out of reach.'],
  face_absent: ['We can\'t see you', 'Stay in front of the camera, facing it, the whole time.'],
  other_voice: ['Another voice was heard', 'We heard speech that was not yours. Only you may speak.'],
  camera_blocked: ['Your camera is covered or dark', 'Uncover the camera and make sure your face is well lit.'],
  camera_frozen: ['Your camera image stopped changing', 'Use your real camera; still images and virtual cameras are not allowed.'],
  background_sound: ['Background sound was heard', 'Music, a TV or other sound is playing near you. Turn it off and stay in a quiet room.'],
  text_injected: ['Text was inserted into your answer', 'Type your answers yourself. Pasting, auto-typing and dictation tools are not allowed.'],
  face_mismatch: ['A different person is on camera', 'The person on camera does not match the person who started.'],
  voice_mismatch: ['The answer was not in your voice', 'The voice in your last answer does not match yours. Only you may answer.'],
};

const newEventId = (type) => `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function useIntegrityGuard({ videoRef, monitorRef, turnRef, context, onTerminate, gazeWarnings = false }) {
  const [violations, setViolations] = useState(0);
  const [maxViolations, setMaxViolations] = useState(3);
  const [maxAwaySeconds, setMaxAwaySeconds] = useState(5);
  const [away, setAway] = useState(null);
  const [awayLeft, setAwayLeft] = useState(null);
  const [warning, setWarning] = useState(null);
  // Soft, non-blocking reminder to look at the screen (opt-in, never counted).
  const [attention, setAttention] = useState(null);
  const [terminated, setTerminated] = useState(null);
  const [enrolled, setEnrolled] = useState(false);

  const r = useRef({
    interviewId: null, violations: 0, max: 3, maxAway: 5, queue: [], proctor: null, scene: null,
    watching: false, terminated: false, warning: null, identity: { enabled: false, enrolled: false },
    attention: createAttentionTracker(), attentionTimer: null, gazeWarnings,
    snapshotTimer: null, snapshotBusy: false, awayTimer: null, outsideSince: null, warned: {}, openEpisodes: {},
    episodes: {
      extra_person: createEpisode({ startAfterMs: 1500, endAfterMs: 3000 }),
      face_absent: createEpisode({ startAfterMs: 10000, endAfterMs: 1500 }),
      // Steady sound while the candidate is not speaking: music, TV, other people.
      background_sound: createEpisode({ startAfterMs: 6000, endAfterMs: 3000 }),
    },
  });
  const latest = useRef({ context, onTerminate });
  latest.current = { context, onTerminate };
  r.current.gazeWarnings = gazeWarnings;

  const guard = useMemo(() => {
    const g = {};
    const s = r.current;

    g.context = () => ({ question_index: turnRef?.current ?? null, part: null, at: null, ...(latest.current.context?.() || {}) });

    g.flushEvents = async () => {
      if (!s.interviewId || !s.queue.length || typeof api.reportProctoringEvents !== 'function') return;
      const batch = s.queue.slice(0, 50);
      try {
        const result = await api.reportProctoringEvents(s.interviewId, batch);
        s.queue = s.queue.slice(batch.length);
        g.syncViolations(result?.violations);
      } catch {
        // Kept for the next attempt.
      }
    };

    g.queueEvent = (event) => {
      s.queue.push({
        id: event.id, type: event.type, question_index: event.question_index ?? null, part: event.part ?? null,
        at: event.at ?? null, duration: event.duration ?? null, details: event.details || {},
      });
      g.flushEvents();
    };

    // The server's count includes its identity events; it never goes down.
    g.syncViolations = (count) => {
      if (!Number.isFinite(count) || count <= s.violations) return;
      s.violations = count;
      setViolations(count);
      if (count >= s.max) g.terminate('violations');
    };

    g.showWarning = (type) => {
      const [title, message] = WARNINGS[type] || ['Integrity warning', 'This has been recorded.'];
      s.warning = { type, title, message };
      setWarning(s.warning);
    };

    g.dismissWarning = () => {
      s.warning = null;
      setWarning(null);
    };

    // Advisory gaze reminder: no modal, no violation count, no pause.
    g.showAttention = (kind) => {
      const message = kind === 'show_face' ? 'Please keep your face visible to the camera.'
        : 'Please look toward the interview screen.';
      setAttention({ kind, message, at: Date.now() });
      clearTimeout(s.attentionTimer);
      s.attentionTimer = setTimeout(() => setAttention(null), GAZE_WARNING_DISPLAY_MS);
    };
    g.clearAttention = () => {
      clearTimeout(s.attentionTimer);
      s.attentionTimer = null;
      setAttention(null);
    };

    g.registerViolation = (type, details = {}, id = newEventId(type)) => {
      if (!s.watching || s.terminated) return;
      s.violations += 1;
      setViolations(s.violations);
      g.queueEvent({ id, type, ...g.context(), details });
      g.showWarning(type);
      if (s.violations >= s.max) g.terminate('violations');
    };

    // Once per answer (another voice, injected text).
    g.flagOnce = (type, details) => {
      if (s.warned[type]) return;
      s.warned[type] = true;
      g.registerViolation(type, details);
    };
    g.newAnswer = () => {
      s.warned = {};
      s.attention.reset();
      g.clearAttention();
    };

    g.handleServerResult = (result) => {
      if (!result?.event || s.terminated) return;
      g.showWarning(result.event.type);
      g.syncViolations(result.violations);
    };

    g.handleEpisode = (type, phase, details = {}) => {
      if (!phase) return;
      if (phase === 'start') {
        const id = newEventId(type);
        s.openEpisodes[type] = { id, context: g.context(), startedAt: performance.now() };
        if (type === 'book_detected') g.queueEvent({ id, type, ...g.context(), details });
        else g.registerViolation(type, details, id);
        return;
      }
      const open = s.openEpisodes[type];
      if (!open) return;
      delete s.openEpisodes[type];
      g.queueEvent({ id: open.id, type, ...open.context, duration: Math.round((performance.now() - open.startedAt) / 100) / 10, details });
      // Someone left the frame or came back: re-check who is there.
      if (type === 'extra_person' || type === 'face_absent') setTimeout(() => g.takeSnapshot(), 1500);
    };

    g.takeSnapshot = async () => {
      if (!s.interviewId || !s.watching || s.snapshotBusy || !s.identity.enrolled
          || typeof api.identitySnapshot !== 'function') return;
      s.snapshotBusy = true;
      try {
        const photo = await captureFrame(videoRef.current, 480);
        if (photo) g.handleServerResult(await api.identitySnapshot(s.interviewId, photo, g.context()));
      } catch {
        // Best effort; the next snapshot follows shortly.
      } finally {
        s.snapshotBusy = false;
      }
    };

    // One analysed camera frame. `signals` (per-answer collector) and
    // `listening` (an answer is being given) enable the lip-movement check.
    g.handleFrame = (observation, time, { signals = null, listening = false } = {}) => {
      if (!s.watching || s.terminated) return;
      const scene = s.scene?.latest?.();
      const extra = observation.faceCount > 1 || (scene?.persons ?? 0) >= 2;
      g.handleEpisode('extra_person', s.episodes.extra_person.update(time, extra),
        { faces: observation.faceCount, persons: scene?.persons ?? null });
      g.handleEpisode('face_absent', s.episodes.face_absent.update(time, !observation.facePresent));
      // Sound the candidate is not making: the room's sound floor stays high
      // while they are silent. Their own speech and the spoken question are
      // excluded (only checked while an answer is being given).
      const sound = listening ? monitorRef?.current?.snapshot?.() : null;
      const loudRoom = Boolean(sound && !sound.speaking && sound.noiseFloor > BACKGROUND_SOUND_FLOOR);
      g.handleEpisode('background_sound', s.episodes.background_sound.update(time, loudRoom));
      if (s.gazeWarnings) {
        const a = s.attention.update(time, observation);
        if (a.warn) g.showAttention(a.warn);
        else if (a.clear) g.clearAttention();
        if (a.episodeStart) g.queueEvent({ id: newEventId('looking_away'), type: 'looking_away', ...g.context() });
      }
      if (!listening || !signals) return;
      const voiced = Boolean(monitorRef?.current?.snapshot()?.speaking);
      const lips = signals.frame({
        t: time, facePresent: observation.facePresent, gazeX: observation.gazeX,
        lookingAway: !observation.eyeContact, mouth: observation.mouth, voiced,
      });
      if (lips.triggered) g.flagOnce('other_voice', { source: 'lip_sync' });
    };

    // Staying outside the page: a countdown, then the end.
    const stopAwayTimer = () => {
      clearInterval(s.awayTimer);
      s.awayTimer = null;
      s.outsideSince = null;
      setAwayLeft(null);
    };
    const startAwayTimer = () => {
      stopAwayTimer();
      s.awayTimer = setInterval(() => {
        const outside = s.proctor?.isOutside ? s.proctor.isOutside() : true;
        if (!outside) {
          s.outsideSince = null;
          setAwayLeft(null);
          return;
        }
        if (s.outsideSince === null) s.outsideSince = performance.now();
        const left = s.maxAway - (performance.now() - s.outsideSince) / 1000;
        setAwayLeft(Math.max(0, Math.ceil(left)));
        if (left <= 0) {
          stopAwayTimer();
          g.terminate('away');
        }
      }, AWAY_TICK_MS);
    };

    g.configure = ({ interviewId, maxViolations: max, violations: count, maxAwaySeconds: limit, identity }) => {
      s.interviewId = interviewId ?? s.interviewId;
      if (max) { s.max = max; setMaxViolations(max); }
      if (Number.isFinite(count)) { s.violations = count; setViolations(count); }
      if (limit) { s.maxAway = limit; setMaxAwaySeconds(limit); }
      if (identity) {
        s.identity = { enabled: Boolean(identity.enabled), enrolled: Boolean(identity.enrolled) };
        setEnrolled(s.identity.enrolled);
      }
    };

    g.needsEnrolment = () => s.identity.enabled && !s.identity.enrolled;
    g.setIdentity = (identity) => {
      s.identity = { ...s.identity, ...identity };
      setEnrolled(Boolean(s.identity.enrolled));
    };

    // Called from the Start click (fullscreen needs a user gesture).
    g.start = async ({ multipleDisplays = false } = {}) => {
      const fullscreen = await enterFullscreen();
      s.watching = true;
      s.proctor?.stop();
      s.proctor = startProctoring({
        context: g.context,
        onLeave: (episode) => {
          s.violations += 1;
          setViolations(s.violations);
          setAway(episode);
          g.queueEvent({ ...episode, details: { types: [...episode.types] } });
          if (s.violations >= s.max) g.terminate('violations');
          else startAwayTimer();
        },
        onReturn: (episode) => {
          stopAwayTimer();
          setAway(null);
          g.queueEvent({ ...episode, details: { types: episode.types } });
        },
        onMinor: (event) => g.queueEvent(event),
      });
      if (videoRef.current && !s.scene) {
        s.scene = startSceneMonitor({ video: () => videoRef.current, onEvent: ({ type, phase }) => g.handleEpisode(type, phase) });
      }
      if (!fullscreen) g.queueEvent({ id: `fs-${Date.now()}`, type: 'fullscreen_unavailable', ...g.context() });
      if (multipleDisplays) g.queueEvent({ id: `md-${Date.now()}`, type: 'multiple_displays', ...g.context() });
      return fullscreen;
    };

    g.startSnapshots = () => {
      clearInterval(s.snapshotTimer);
      if (s.identity.enrolled) s.snapshotTimer = setInterval(g.takeSnapshot, SNAPSHOT_EVERY_MS);
    };

    g.stop = () => {
      s.watching = false;
      s.proctor?.stop();
      s.scene?.stop();
      s.scene = null;
      clearInterval(s.snapshotTimer);
      stopAwayTimer();
      s.attention.reset();
      g.clearAttention();
    };

    g.returnToInterview = async () => {
      await enterFullscreen();
      window.focus?.();
      s.proctor?.check();
    };

    g.isPaused = () => Boolean(s.proctor?.isAway?.() || s.warning);
    g.isTerminated = () => s.terminated;
    g.isWatching = () => s.watching;

    g.terminate = async (reason) => {
      if (s.terminated) return;
      g.stop();
      s.terminated = true;
      s.warning = null;
      setAway(null);
      setWarning(null);
      setTerminated(reason);
      await g.flushEvents();
      await exitFullscreen();
      latest.current.onTerminate?.(reason);
    };
    return g;
  }, [videoRef, monitorRef, turnRef]);

  useEffect(() => () => guard.stop(), [guard]);

  // Stable between state changes, so callbacks depending on it rarely change.
  return useMemo(() => ({
    ...guard, violations, maxViolations, maxAwaySeconds, away, awayLeft, warning, attention, terminated, enrolled,
  }), [guard, violations, maxViolations, maxAwaySeconds, away, awayLeft, warning, attention, terminated, enrolled]);
}
