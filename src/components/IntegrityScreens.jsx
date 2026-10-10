import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Mic, ScanFace, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { Notice, Panel, Spinner } from './ui';
import { api } from '../services/api';
import { speak, stopSpeaking } from '../services/speech';
import { startAnswerRecording } from '../services/answerRecorder';
import { captureFrame } from '../services/cameraSnapshot';

// -------------------------------------------------------------
// Screens shared by the interview and the ranked Arena:
//   VoiceBars          speaking / microphone level animation
//   IntegrityOverlays  "you left" (with the away countdown) and warnings
//   RulesStep          the rules, read aloud before anything else
//   IdentityEnrolment  photo + one sentence read aloud
// -------------------------------------------------------------

export function VoiceBars({ level = null, bars = 18 }) {
  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => {
        const shape = 0.35 + 0.65 * Math.abs(Math.sin((index + 1) * 1.7));
        const height = level === null ? shape : Math.max(0.12, Math.min(1, level * 1.6 * shape + 0.08));
        return (
          <span
            key={index}
            className={`w-[3px] rounded-full bg-ink transition-[height] duration-150 ${level === null ? 'wave-bar' : ''}`}
            style={{ height: `${Math.round(height * 100)}%`, '--i': index }}
          />
        );
      })}
    </div>
  );
}

function Dialog({ id, title, children, action }) {
  return (
    <div className="fade-in fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby={id} className="scale-in w-full max-w-md rounded-panel border border-line bg-surface p-7 text-center shadow-pop">
        <ShieldAlert className="mx-auto h-8 w-8 text-bad" />
        <h2 id={id} className="mt-4 font-serif text-[1.8rem] leading-tight text-ink">{title}</h2>
        {children}
        {action}
      </div>
    </div>
  );
}

export function IntegrityOverlays({ guard, sessionLabel = 'interview' }) {
  const { away, warning, violations, maxViolations, awayLeft, maxAwaySeconds } = guard;
  if (away) {
    return (
      <Dialog
        id="away-title"
        title={`You left the ${sessionLabel}`}
        action={<button className="primary-btn mt-6 w-full !py-3" onClick={guard.returnToInterview}>Return to the {sessionLabel}</button>}
      >
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Leaving fullscreen, switching tabs or opening other windows and apps is not allowed and has been recorded.
        </p>
        {awayLeft !== null && (
          <p className="mt-3 text-sm font-medium text-bad" role="timer">The {sessionLabel} ends in {awayLeft} s unless you return.</p>
        )}
        <p className="mt-4 text-sm font-medium text-bad">Warning {violations} of {maxViolations}</p>
        <p className="mt-1 text-xs text-ink-3">
          Staying away {maxAwaySeconds} seconds, or {maxViolations} warnings, ends the {sessionLabel}.
        </p>
      </Dialog>
    );
  }
  if (warning) {
    return (
      <Dialog
        id="warning-title"
        title={warning.title}
        action={<button className="primary-btn mt-6 w-full !py-3" onClick={guard.dismissWarning}>Continue the {sessionLabel}</button>}
      >
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{warning.message} This has been recorded.</p>
        <p className="mt-4 text-sm font-medium text-bad">Warning {violations} of {maxViolations}</p>
        <p className="mt-1 text-xs text-ink-3">At {maxViolations} the {sessionLabel} ends and unanswered questions score 0.</p>
      </Dialog>
    );
  }
  return null;
}

export function rulesFor({ maxViolations, maxAwaySeconds, arena }) {
  return [
    ['Be alone', 'No other person may be in the room, speak, or help you. Nobody else may answer.'],
    ['No AI or outside help', 'No AI tools, websites, notes, books, phones or other devices. Do not read prepared answers.'],
    ['Stay on this screen', `It runs in fullscreen. Switching tabs, windows or apps is a warning; staying away ${maxAwaySeconds} seconds ends it immediately.`],
    ['Stay visible', 'Keep your face in view. Your face and voice are checked against the identity check throughout.'],
    ['Your own words and code', 'No copying, pasting, auto-typing or dictation tools.'],
    ['Warnings', `After ${maxViolations} warnings it ends and unanswered questions score 0.${arena ? ' In the Arena every warning also lowers your rating.' : ''}`],
  ];
}

export function RulesStep({ maxViolations, maxAwaySeconds, arena = false, onContinue }) {
  const [ready, setReady] = useState(false);
  const rules = rulesFor({ maxViolations, maxAwaySeconds, arena });
  useEffect(() => {
    let active = true;
    const fallback = setTimeout(() => active && setReady(true), 4000);
    speak({ phrase: 'rules' }, `Before we begin, here are the rules. ${rules.map(([t, d]) => `${t}. ${d}`).join(' ')}`)
      .finally(() => { if (active) setReady(true); });
    return () => {
      active = false;
      clearTimeout(fallback);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Panel className="mx-auto max-w-3xl p-7 sm:p-9">
      <p className="flex items-center gap-2 text-[13px] text-ink-3"><ShieldCheck className="h-4 w-4" /> Rules</p>
      <h1 className="mt-2 font-serif text-[2rem] leading-[1.1] tracking-[-0.02em] text-ink">Before we begin</h1>
      <ol className="mt-6 space-y-3">
        {rules.map(([title, detail], index) => (
          <li key={title} className="reveal flex gap-3 text-sm leading-relaxed text-ink-2" style={{ '--i': index }}>
            <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink font-mono text-[11px] text-paper">{index + 1}</span>
            <span><span className="font-medium text-ink">{title}.</span> {detail}</span>
          </li>
        ))}
      </ol>
      <button className="primary-btn mt-8 !px-6 !py-3" onClick={() => { stopSpeaking(); onContinue(); }} disabled={!ready}>
        {ready ? 'I understand' : 'Reading the rules…'} <ArrowRight className="h-4 w-4" />
      </button>
    </Panel>
  );
}

export const ENROL_SENTENCE = 'I confirm that I am taking this interview myself, without help from any person, device or tool.';
const ENROL_MIN_SPEECH_MS = 3500;
const ENROL_END_SILENCE_MS = 1200;
const ENROL_MAX_MS = 15000;

export function IdentityEnrolment({ interviewId, videoRef, streamRef, monitorRef, onDone }) {
  const [enrol, setEnrol] = useState({ status: 'idle', message: '', level: 0 });
  const stopRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function start() {
    stopRef.current = false;
    setEnrol({ status: 'recording', message: '', level: 0 });
    const photo = await captureFrame(videoRef.current, 640);
    if (!photo) {
      setEnrol({ status: 'error', message: 'Your camera image is not available yet. Check the camera and try again.', level: 0 });
      return;
    }
    monitorRef.current?.reset();
    const recording = startAnswerRecording(streamRef.current);
    const startedAt = performance.now();
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const snapshot = monitorRef.current?.snapshot();
        if (mountedRef.current) setEnrol((current) => ({ ...current, level: snapshot?.level ?? 0 }));
        const finished = snapshot && snapshot.speechMs >= ENROL_MIN_SPEECH_MS && snapshot.silenceMs >= ENROL_END_SILENCE_MS;
        if (finished || performance.now() - startedAt >= ENROL_MAX_MS || stopRef.current || !mountedRef.current) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
    const audio = await recording?.stop();
    if (!mountedRef.current) return;
    setEnrol({ status: 'uploading', message: '', level: 0 });
    try {
      const result = await api.enrollIdentity(interviewId, photo, audio);
      setEnrol({ status: 'done', message: '', level: 0 });
      onDone({ enabled: Boolean(result?.available), enrolled: Boolean(result?.enrolled && result?.face) });
    } catch (error) {
      setEnrol({
        status: 'error',
        message: error?.status === 422 && error.detail
          ? error.detail
          : 'We could not complete the identity check. Check your connection and try again.',
        level: 0,
      });
    }
  }

  const busy = enrol.status === 'recording' || enrol.status === 'uploading' || enrol.status === 'done';
  return (
    <Panel className="mx-auto max-w-3xl overflow-hidden">
      <div className="grid sm:grid-cols-[minmax(0,1fr)_260px]">
        <div className="p-7 sm:p-9">
          <p className="flex items-center gap-2 text-[13px] text-ink-3"><ScanFace className="h-4 w-4" /> Identity check</p>
          <h1 className="mt-2 font-serif text-[2rem] leading-[1.1] tracking-[-0.02em] text-ink">Look at the camera and read this aloud</h1>
          <blockquote className="mt-5 rounded-xl border border-line bg-paper px-5 py-4 font-serif text-[1.2rem] leading-snug text-ink">
            &ldquo;{ENROL_SENTENCE}&rdquo;
          </blockquote>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
            Your photo and voice from this check are compared with the rest of the session to confirm the same person answers every question. Only you should be in view.
          </p>
          {enrol.status === 'recording' && (
            <div className="mt-5 flex items-center gap-3 text-sm text-ink-2" aria-live="polite">
              <Mic className="h-4 w-4 text-bad" /> Listening… <VoiceBars level={enrol.level} bars={14} />
            </div>
          )}
          {enrol.status === 'uploading' && <p className="mt-5 flex items-center gap-2 text-sm text-ink-2"><Spinner /> Checking…</p>}
          {enrol.status === 'error' && <Notice tone="warn" role="alert" className="mt-5">{enrol.message}</Notice>}
          <div className="mt-7 flex flex-wrap gap-2">
            {!busy && (
              <button className="primary-btn !px-6 !py-3" onClick={start}>
                {enrol.status === 'error' ? 'Try again' : 'Start reading'} <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {enrol.status === 'recording' && (
              <button className="ghost-btn" onClick={() => { stopRef.current = true; }}>I&apos;ve finished</button>
            )}
          </div>
        </div>
        <div className="relative bg-ink">
          <video ref={videoRef} autoPlay muted playsInline className="h-full min-h-[220px] w-full object-cover" />
        </div>
      </div>
    </Panel>
  );
}

export function TerminatedScreen({ reason, violations, maxAwaySeconds, sessionLabel = 'interview', detail }) {
  return (
    <Panel className="mx-auto max-w-xl p-8 text-center">
      <ShieldAlert className="mx-auto h-8 w-8 text-bad" />
      <h1 className="mt-4 font-serif text-[2rem] leading-tight text-ink">{sessionLabel === 'interview' ? 'Interview ended' : 'Arena ended'}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        {reason === 'away'
          ? `You stayed outside the ${sessionLabel} for more than ${maxAwaySeconds} seconds.`
          : `The ${sessionLabel} was stopped after ${violations} integrity warnings.`}
        {' '}{detail}
      </p>
      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-3"><Spinner /> Saving and preparing your results…</p>
    </Panel>
  );
}
