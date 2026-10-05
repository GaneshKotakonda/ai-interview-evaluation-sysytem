import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Mic,
  RotateCcw,
  ShieldAlert,
  SkipForward,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BehaviorMonitor from '../components/BehaviorMonitor';
import {
  Badge, FlowSteps, Notice, Panel, Skeleton, Spinner,
} from '../components/ui';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { speak, stopSpeaking, playTurnChime } from '../services/speech';
import { createVoiceMonitor } from '../services/voiceActivity';
import { startAnswerRecording } from '../services/answerRecorder';
import { startSessionRecording } from '../services/sessionRecorder';
import {
  enterFullscreen, exitFullscreen, fullscreenSupported, hasMultipleDisplays, startProctoring,
} from '../services/proctoring';
import { STORAGE_KEYS, clearInterviewProgress, readAnswerMode } from '../utils/interviewJourney';

// -------------------------------------------------------------
// BLOCK 0: Interview pacing (voice mode)
// -------------------------------------------------------------
// After the candidate has spoken, this much silence starts a short
// countdown; speaking again cancels it. The countdown then moves on.
const SILENCE_BEFORE_COUNTDOWN_MS = 4000;
const COUNTDOWN_MS = 3000;
// Spoken at least this long before silence can end an answer.
const MIN_SPEECH_MS = 800;
// No voice at all after this long: show a "we can't hear you" hint.
const NO_VOICE_HINT_MS = 20000;
// Hard limit per answer.
const MAX_ANSWER_MS = 3 * 60 * 1000;
const TICK_MS = 200;

const STORAGE_KEY = STORAGE_KEYS.progress;
const DURATION_KEY = STORAGE_KEYS.duration;
const INTERVIEW_ID_KEY = STORAGE_KEYS.interviewId;

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

// Animated bars: the interviewer speaking (level = null) or the live mic level.
function VoiceBars({ level = null, bars = 18 }) {
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

export default function Interview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const answerMode = useMemo(() => readAnswerMode(), []);
  const voiceMode = answerMode === 'voice';

  // -------------------------------------------------------------
  // BLOCK 1: Media and long-lived references
  // -------------------------------------------------------------
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const sessionRef = useRef(null);          // whole-interview recorder
  const monitorRef = useRef(null);          // voice activity monitor
  const answerRecRef = useRef(null);        // current answer's audio recorder
  const visionMetricsRef = useRef(null);    // session camera metrics
  const answerVisionRef = useRef(null);     // this answer's camera metrics
  const responseIdRef = useRef(null);       // accepted answer awaiting advance
  const pendingRef = useRef(null);          // { text } answer awaiting submit
  const pendingAudioRef = useRef(null);     // recorded answer awaiting transcription
  const answerStartRef = useRef(0);
  const noSpeechRetriesRef = useRef(0);
  const busyRef = useRef(false);
  const unmountedRef = useRef(false);
  const startRequestRef = useRef(null);
  const resumeRef = useRef(null);           // /state payload when resuming
  const beganAtRef = useRef(null);
  // Proctoring
  const proctorRef = useRef(null);
  const violationsRef = useRef(0);
  const maxViolationsRef = useRef(5);
  const eventQueueRef = useRef([]);
  const terminatedRef = useRef(false);
  const turnRef = useRef(1);

  // -------------------------------------------------------------
  // BLOCK 2: State
  // -------------------------------------------------------------
  const [stage, setStage] = useState('loading');
  const [interviewId, setInterviewId] = useState(null);
  const [question, setQuestion] = useState(null);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [maxTurns, setMaxTurns] = useState(1);
  const [responses, setResponses] = useState([]);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [flowError, setFlowError] = useState('');
  const [startAttempt, setStartAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [listen, setListen] = useState({ level: 0, countdown: null, seconds: 0, noVoice: false });
  const [recordingIssue, setRecordingIssue] = useState(false);
  const [away, setAway] = useState(null);           // current "left the interview" episode
  const [violations, setViolations] = useState(0);
  const [maxViolations, setMaxViolations] = useState(5);
  const multipleDisplays = useMemo(() => hasMultipleDisplays(), []);

  const targetRole = useMemo(() => localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer', []);
  const targetJd = useMemo(() => localStorage.getItem(STORAGE_KEYS.jobDescription) || '', []);
  const isLastTurn = currentTurn >= maxTurns;

  // -------------------------------------------------------------
  // BLOCK 3: Start or resume the session (before the candidate clicks Start)
  // -------------------------------------------------------------
  // An interview id left in storage means the page was reloaded during an
  // interview (Readiness clears it before a new one), so try to resume it.
  async function resumeState(savedId) {
    if (!savedId || typeof api.getInterviewState !== 'function') return null;
    try {
      const state = await api.getInterviewState(savedId);
      if (state?.status !== 'in_progress' || state.interview_mode === 'game') return null;
      if (!state.awaiting_completion && !state.question) return null;
      return { ...state, resumed: true };
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setStage('loading');
      try {
        // Shared across StrictMode effect replays so only one session starts.
        if (!startRequestRef.current) {
          startRequestRef.current = (async () => {
            const resumable = await resumeState(localStorage.getItem(INTERVIEW_ID_KEY));
            if (resumable) return resumable;
            return api.startInterview(
              localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer', user?.uid || null,
              localStorage.getItem(STORAGE_KEYS.jobDescription) || null,
              user?.email || null, user?.displayName || null, 5, 'standard', answerMode,
            );
          })();
        }
        const data = await startRequestRef.current;
        if (!active) return;
        if (data?.awaiting_completion) {
          navigate('/interview-complete');
          return;
        }
        if (!data?.question?.question || !data.interview_id) throw new Error('Invalid interview session');
        setInterviewId(data.interview_id);
        maxViolationsRef.current = data.proctoring?.max_violations || 5;
        setMaxViolations(maxViolationsRef.current);
        violationsRef.current = data.proctoring?.violations || 0;
        setViolations(violationsRef.current);
        setQuestion(data.question);
        setCurrentTurn(data.current_turn);
        setMaxTurns(data.max_turns);
        if (data.resumed) {
          resumeRef.current = data;
          const answered = data.answered.filter((item) => item.index !== data.current_turn);
          const pending = data.answered.find((item) => item.index === data.current_turn);
          const current = { ...data.question, answer: '', completed: false };
          setResponses([...answered, pending ? { ...current, ...pending } : current]);
          if (data.pending_response_id) responseIdRef.current = data.pending_response_id;
        } else {
          setResponses([{ ...data.question, answer: '', completed: false }]);
          localStorage.setItem(INTERVIEW_ID_KEY, data.interview_id);
          localStorage.removeItem(STORAGE_KEYS.latestReport);
          clearInterviewProgress();
        }
        setFlowError('');
        setStage('ready');
      } catch {
        if (!active) return;
        startRequestRef.current = null;
        setFlowError('Unable to start your interview. Please check your connection and retry.');
        setStage('start-error');
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, startAttempt]);

  // -------------------------------------------------------------
  // BLOCK 4: Camera and microphone
  // -------------------------------------------------------------
  useEffect(() => {
    unmountedRef.current = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media capture is not supported by this browser.');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          // Echo cancellation keeps the spoken questions out of the answer.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (unmountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setCameraReady(stream.getVideoTracks().length > 0);
        setMicrophoneReady(stream.getAudioTracks().length > 0);
      } catch (error) {
        if (!unmountedRef.current) setMediaError(error?.message || 'Camera and microphone access is required.');
      }
    })();
    return () => {
      unmountedRef.current = true;
      proctorRef.current?.stop();
      exitFullscreen();
      stopSpeaking();
      monitorRef.current?.stop();
      answerRecRef.current?.cancel?.();
      sessionRef.current?.stop({ timeoutMs: 5000 });
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Attach the stream whenever the video element is (re)mounted.
  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.()?.catch?.(() => {});
    }
  });

  // Elapsed interview time.
  useEffect(() => {
    if (!beganAtRef.current || stage === 'finishing') return undefined;
    const timer = setInterval(() => setElapsed((Date.now() - beganAtRef.current) / 1000), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  useEffect(() => { turnRef.current = currentTurn; }, [currentTurn]);

  // Keep the journey in storage for the completion page and the report.
  useEffect(() => {
    if (interviewId && responses.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ interviewId, current_turn: currentTurn, max_turns: maxTurns, responses }));
    }
  }, [interviewId, currentTurn, maxTurns, responses]);

  // -------------------------------------------------------------
  // BLOCK 5: The interview loop
  // -------------------------------------------------------------
  // speak question → chime → listen → (Next | silence | time limit) →
  // transcribe → grade silently → speak next question … → outro → report.
  const startListening = useCallback(() => {
    if (unmountedRef.current || terminatedRef.current) return;
    answerStartRef.current = sessionRef.current?.elapsedSeconds() ?? 0;
    setListen({ level: 0, countdown: null, seconds: 0, noVoice: false });
    pendingAudioRef.current = null;
    if (voiceMode) {
      answerRecRef.current = startAnswerRecording(streamRef.current);
      monitorRef.current?.reset();
    }
    setStage('listening');
  }, [voiceMode]);

  const askQuestion = useCallback(async (nextQuestion, id) => {
    if (unmountedRef.current || terminatedRef.current) return;
    setQuestion(nextQuestion);
    setTypedAnswer('');
    noSpeechRetriesRef.current = 0;
    setStage('speaking');
    await speak({ interviewId: id, item: `question-${nextQuestion.index}` },
      `Question ${nextQuestion.index}. ${nextQuestion.question}`);
    if (unmountedRef.current || terminatedRef.current) return;
    playTurnChime();
    startListening();
  }, [startListening]);

  const finishInterview = useCallback(async (id) => {
    if (terminatedRef.current) return;
    proctorRef.current?.stop();
    setStage('finishing');
    monitorRef.current?.stop();
    const duration = beganAtRef.current ? Math.round((Date.now() - beganAtRef.current) / 1000) : 0;
    await Promise.all([
      speak({ interviewId: id, item: 'outro' }, 'That is the end of the interview. Thank you for your time.'),
      sessionRef.current?.stop() ?? Promise.resolve(),
    ]);
    localStorage.setItem(DURATION_KEY, String(duration));
    if (visionMetricsRef.current) {
      localStorage.setItem(STORAGE_KEYS.visionMetrics, JSON.stringify(visionMetricsRef.current));
    }
    await flushEvents(id);
    await exitFullscreen();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (!unmountedRef.current) navigate('/interview-complete');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // -------------------------------------------------------------
  // BLOCK 5b: Proctoring
  // -------------------------------------------------------------
  // Integrity events are queued and sent in order; a failed send stays in
  // the queue and goes with the next one (the server ignores repeats).
  async function flushEvents(id = interviewId) {
    if (!id || !eventQueueRef.current.length || typeof api.reportProctoringEvents !== 'function') return;
    const batch = eventQueueRef.current.slice(0, 50);
    try {
      await api.reportProctoringEvents(id, batch);
      eventQueueRef.current = eventQueueRef.current.slice(batch.length);
    } catch {
      // Kept for the next attempt.
    }
  }

  const queueEvent = (event) => {
    eventQueueRef.current.push({
      id: event.id,
      type: event.type,
      question_index: event.question_index ?? null,
      part: event.part ?? null,
      at: event.at ?? null,
      duration: event.duration ?? null,
      details: event.details || {},
    });
    flushEvents();
  };

  const proctorContext = () => ({
    question_index: turnRef.current,
    part: sessionRef.current?.part ?? null,
    at: sessionRef.current ? sessionRef.current.elapsedSeconds() : null,
  });

  // Too many violations: end the interview now; unanswered questions score 0.
  const terminate = useCallback(async () => {
    if (terminatedRef.current) return;
    terminatedRef.current = true;
    proctorRef.current?.stop();
    setAway(null);
    setStage('terminated');
    stopSpeaking();
    answerRecRef.current?.cancel?.();
    monitorRef.current?.stop();
    localStorage.setItem(STORAGE_KEYS.endedEarly, '1');
    const duration = beganAtRef.current ? Math.round((Date.now() - beganAtRef.current) / 1000) : 0;
    localStorage.setItem(DURATION_KEY, String(duration));
    if (visionMetricsRef.current) {
      localStorage.setItem(STORAGE_KEYS.visionMetrics, JSON.stringify(visionMetricsRef.current));
    }
    await Promise.all([flushEvents(), sessionRef.current?.stop() ?? Promise.resolve()]);
    await exitFullscreen();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (!unmountedRef.current) setTimeout(() => navigate('/interview-complete'), 2500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, interviewId]);

  const startWatching = () => {
    proctorRef.current?.stop();
    proctorRef.current = startProctoring({
      context: proctorContext,
      onLeave: (episode) => {
        violationsRef.current += 1;
        setViolations(violationsRef.current);
        setAway(episode);
        queueEvent({ ...episode, details: { types: [...episode.types] } });
        if (violationsRef.current >= maxViolationsRef.current) terminate();
      },
      onReturn: (episode) => {
        setAway(null);
        queueEvent({ ...episode, details: { types: episode.types } });
      },
      onMinor: (event) => queueEvent(event),
    });
  };

  const returnToInterview = async () => {
    await enterFullscreen();
    window.focus?.();
    proctorRef.current?.check();
  };

  // Submit (once) and advance. Retries reuse the accepted response.
  const submitAndAdvance = useCallback(async (id, turnQuestion, text) => {
    if (!responseIdRef.current) {
      const recording = sessionRef.current
        ? { part: sessionRef.current.part, start: answerStartRef.current, end: sessionRef.current.elapsedSeconds() }
        : null;
      const saved = await api.submitAnswer(id, {
        questionIndex: turnQuestion.index,
        questionText: turnQuestion.question,
        candidateAnswer: text,
        videoBlob: null,
        visionMetrics: answerVisionRef.current,
        recording,
      });
      if (!saved?.response_id) throw new Error('Missing response identifier');
      responseIdRef.current = saved.response_id;
      setResponses((current) => current.map((item, index) => (index === current.length - 1
        ? { ...item, answer: text, completed: true, response_id: saved.response_id, evaluation: saved.evaluation }
        : item)));
    }
    const result = await api.nextQuestion(id, responseIdRef.current);
    if (!result.is_complete && !result.next_question?.question) throw new Error('Missing next question');
    setResponses((current) => current.map((item, index) => (index === current.length - 1
      ? { ...item, completed: true, evaluation: result.evaluation || item.evaluation, adaptation: result.adaptation }
      : item)));
    responseIdRef.current = null;
    pendingRef.current = null;
    answerVisionRef.current = null;
    if (result.is_complete) {
      await finishInterview(id);
      return;
    }
    setCurrentTurn(result.current_turn);
    setMaxTurns(result.max_turns);
    setResponses((current) => [...current, { ...result.next_question, answer: '', completed: false }]);
    await askQuestion(result.next_question, id);
  }, [askQuestion, finishInterview]);

  // Ends the current answer: transcribe (voice) and hand over to grading.
  const finishAnswer = useCallback(async () => {
    if (busyRef.current || !interviewId || !question) return;
    busyRef.current = true;
    setFlowError('');
    setStage('processing');
    try {
      if (!pendingRef.current && !responseIdRef.current) {
        let text = '';
        if (voiceMode) {
          // Keep the audio until it is transcribed, so a network retry
          // never loses the spoken answer.
          let blob = pendingAudioRef.current;
          if (!blob) {
            blob = await answerRecRef.current?.stop();
            answerRecRef.current = null;
            pendingAudioRef.current = blob || null;
            speak({ phrase: 'thanks' }, '');
          }
          if (blob) {
            try {
              const result = await api.transcribeAnswer(interviewId, question.index, blob);
              text = (result?.transcript || '').trim();
            } catch (error) {
              if (error?.status === 422 && noSpeechRetriesRef.current < 1) {
                // Nothing intelligible was heard: ask once more.
                noSpeechRetriesRef.current += 1;
                await speak({ phrase: 'no_speech' }, "Sorry, I couldn't hear an answer. Please try answering again.");
                busyRef.current = false;
                startListening();
                return;
              }
              if (error?.status !== 422) throw error;
            }
          }
        } else {
          text = typedAnswer.trim();
          speak({ phrase: 'thanks' }, '');
        }
        pendingRef.current = { text };
        pendingAudioRef.current = null;
      }
      await submitAndAdvance(interviewId, question, pendingRef.current?.text ?? '');
    } catch {
      setFlowError(responseIdRef.current
        ? 'Your answer is saved. Retry to continue to the next question.'
        : 'We could not save your answer. Check your connection and retry; nothing has been lost.');
      setStage('retry');
    } finally {
      busyRef.current = false;
    }
  }, [interviewId, question, voiceMode, typedAnswer, startListening, submitAndAdvance]);

  // The candidate's click also unlocks audio playback (browser autoplay rules).
  const begin = useCallback(async () => {
    if (!interviewId || busyRef.current) return;
    beganAtRef.current = Date.now();
    // Fullscreen needs this click (a user gesture); then watch for leaving.
    const fullscreen = await enterFullscreen();
    const resumed = resumeRef.current;
    const part = (resumed?.recording_parts?.length ? Math.max(...resumed.recording_parts) : 0) + 1;
    if (streamRef.current) {
      sessionRef.current = startSessionRecording({
        stream: streamRef.current, interviewId, part,
        onUploadError: () => setRecordingIssue(true),
      });
      if (voiceMode) monitorRef.current = createVoiceMonitor(streamRef.current);
    }
    startWatching();
    if (!fullscreen) queueEvent({ id: `fs-${Date.now()}`, type: 'fullscreen_unavailable', ...proctorContext() });
    if (multipleDisplays) queueEvent({ id: `md-${Date.now()}`, type: 'multiple_displays', ...proctorContext() });
    if (resumed?.pending_response_id) {
      // The last answer was saved before the reload; continue from it.
      pendingRef.current = { text: '' };
      await finishAnswer();
      return;
    }
    if (!resumed) {
      setStage('speaking');
      await speak({ interviewId, item: 'intro' },
        `Welcome to your ${targetRole} interview. Answer each question out loud, then pause or select Next.`);
    }
    await askQuestion(question, interviewId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId, question, voiceMode, targetRole, askQuestion, finishAnswer, multipleDisplays]);

  const repeatQuestion = useCallback(async () => {
    answerRecRef.current?.cancel?.();
    answerRecRef.current = null;
    await askQuestion(question, interviewId);
  }, [question, interviewId, askQuestion]);

  // -------------------------------------------------------------
  // BLOCK 6: Listening loop (voice mode): level meter, silence, time limit
  // -------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'listening' || !voiceMode) return undefined;
    const timer = setInterval(() => {
      // While the candidate is away the answer cannot end by silence.
      if (proctorRef.current?.isAway()) return;
      const snapshot = monitorRef.current?.snapshot();
      if (!snapshot) {
        const seconds = (sessionRef.current?.elapsedSeconds() ?? 0) - answerStartRef.current;
        setListen((current) => ({ ...current, seconds }));
        if (seconds * 1000 >= MAX_ANSWER_MS) finishAnswer();
        return;
      }
      const spoke = snapshot.speechMs >= MIN_SPEECH_MS;
      const quietFor = spoke ? snapshot.silenceMs - SILENCE_BEFORE_COUNTDOWN_MS : -1;
      const countdown = quietFor > 0 ? Math.max(0, Math.ceil((COUNTDOWN_MS - quietFor) / 1000)) : null;
      setListen({
        level: snapshot.level,
        countdown,
        seconds: snapshot.elapsedMs / 1000,
        noVoice: !spoke && snapshot.elapsedMs > NO_VOICE_HINT_MS,
      });
      if ((spoke && quietFor >= COUNTDOWN_MS) || snapshot.elapsedMs >= MAX_ANSWER_MS) finishAnswer();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [stage, voiceMode, finishAnswer]);
  // `fullscreenSupported` is used for the ready-screen rules below.
  const canFullscreen = fullscreenSupported();

  // -------------------------------------------------------------
  // BLOCK 7: Render
  // -------------------------------------------------------------
  if (stage === 'loading') {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <FlowSteps current={1} />
        <Panel className="p-8 sm:p-10">
          <div className="flex items-center gap-2 text-[13px] text-ink-3"><Spinner /> Preparing your interview</div>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-ink">Writing your first question for {targetRole}…</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            The first question starts at medium difficulty; later questions adapt to your answers.
          </p>
          <div className="mt-8 space-y-3">
            <Skeleton className="h-5 w-11/12" />
            <Skeleton className="h-5 w-8/12" />
          </div>
        </Panel>
      </div>
    );
  }

  if (stage === 'start-error') {
    return (
      <Panel className="mx-auto max-w-xl p-6">
        <p role="alert" className="text-sm text-ink-2">{flowError}</p>
        <button className="primary-btn mt-4" onClick={() => setStartAttempt((value) => value + 1)}>Retry Start</button>
      </Panel>
    );
  }

  const resumed = Boolean(resumeRef.current);
  const voiceBlocked = voiceMode && !microphoneReady;

  if (stage === 'ready') {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <FlowSteps current={1} />
        <Panel className="overflow-hidden">
          <div className="grid sm:grid-cols-[minmax(0,1fr)_240px]">
            <div className="p-7 sm:p-9">
              <p className="text-[13px] text-ink-3">{targetRole} · {maxTurns} questions</p>
              <h1 className="mt-2 font-serif text-[2.4rem] leading-[1.05] tracking-[-0.02em] text-ink">
                {resumed ? 'Welcome back' : 'Ready when you are'}
              </h1>
              <ul className="mt-6 space-y-2.5 text-sm text-ink-2">
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />Each question is read aloud. Use headphones or turn your volume up.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
                  {voiceMode ? 'Answer out loud. Select Next when you finish, or pause and the interview moves on.' : 'Type each answer and submit it.'}
                </li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />The whole interview is recorded on camera. Your report appears at the end.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-bad" />
                  <span>
                    <span className="font-medium text-ink">Stay in the interview.</span>{' '}
                    {canFullscreen ? 'It runs in fullscreen. ' : ''}Switching tabs, windows or apps, copying and pasting are recorded; after {maxViolations} times the interview ends automatically.
                  </span>
                </li>
              </ul>
              {multipleDisplays && <Notice tone="warn" className="mt-6">A second display is connected. Disconnect it before starting; this is recorded in your report.</Notice>}
              {resumed && <Notice className="mt-6">Your earlier answers are saved. The interview continues from question {currentTurn}.</Notice>}
              {mediaError && <Notice tone="warn" className="mt-6">{mediaError}</Notice>}
              {voiceBlocked && !mediaError && <Notice tone="warn" className="mt-6">Waiting for microphone access…</Notice>}
              <button onClick={begin} disabled={voiceBlocked} className="primary-btn mt-8 !px-6 !py-3.5 text-[15px]">
                {resumed ? 'Continue Interview' : 'Start Interview'} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="relative hidden bg-ink sm:block">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && <div className="absolute inset-0 grid place-items-center text-paper/60"><Camera className="h-6 w-6" /></div>}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (stage === 'terminated') {
    return (
      <Panel className="mx-auto max-w-xl p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-bad" />
        <h1 className="mt-4 font-serif text-[2rem] leading-tight text-ink">Interview ended</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          You left the interview {violations} times. Your answers so far are saved and graded; unanswered questions score 0.
        </p>
        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-3"><Spinner /> Saving the recording and preparing your report…</p>
      </Panel>
    );
  }

  const statusLine = {
    speaking: 'Interviewer is asking…',
    listening: voiceMode ? 'Listening' : 'Your answer',
    processing: 'Thinking…',
    retry: 'Connection problem',
    finishing: 'Wrapping up…',
  }[stage];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {away && (
        <div className="fade-in fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" aria-labelledby="away-title" className="scale-in w-full max-w-md rounded-panel border border-line bg-surface p-7 text-center shadow-pop">
            <ShieldAlert className="mx-auto h-8 w-8 text-bad" />
            <h2 id="away-title" className="mt-4 font-serif text-[1.8rem] leading-tight text-ink">You left the interview</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              Leaving fullscreen, switching tabs or opening other windows and apps is not allowed and has been recorded.
            </p>
            <p className="mt-4 text-sm font-medium text-bad">Warning {violations} of {maxViolations}</p>
            <p className="mt-1 text-xs text-ink-3">At {maxViolations} the interview ends and unanswered questions score 0.</p>
            <button className="primary-btn mt-6 w-full !py-3" onClick={returnToInterview}>Return to the interview</button>
          </div>
        </div>
      )}

      {/* Header: role, question counter, recording, elapsed time, progress */}
      <header className="reveal space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span>{targetRole}</span>
              {targetJd && <Badge tone="ink">Tailored to JD</Badge>}
            </div>
            <h1 className="mt-1 font-serif text-[2.1rem] tracking-[-0.02em] leading-none text-ink">
              Question {currentTurn} of {maxTurns}
            </h1>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2">
              <span className="pulse-dot h-2 w-2 rounded-full bg-bad" /> Recording
            </span>
            <span className="num rounded-full border border-line bg-surface px-3.5 py-1.5 font-mono text-sm text-ink">
              <span className="sr-only">Elapsed time </span>{formatClock(elapsed)}
            </span>
          </div>
        </div>
        <div role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={maxTurns} aria-valuenow={currentTurn} className="flex gap-1.5">
          {Array.from({ length: maxTurns }, (_, index) => {
            const turn = index + 1;
            const done = turn < currentTurn || (turn === currentTurn && stage === 'finishing');
            return (
              <span key={turn} className="relative h-1 flex-1 overflow-hidden rounded-full bg-line">
                {(done || turn === currentTurn) && <span className={`grow-x absolute inset-0 rounded-full ${done ? 'bg-ink' : 'bg-ink/35'}`} />}
              </span>
            );
          })}
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-5">
          {/* The interviewer: question + what is happening now */}
          <Panel i={1} as="article" key={`question-${currentTurn}`} className="overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="num font-mono text-ink-3">Q{currentTurn}</span>
                <span className="text-ink-4">·</span>
                <Badge>{question?.difficulty?.replace(/^./, (c) => c.toUpperCase())}</Badge>
                {question?.is_follow_up && <Badge tone="ink">AI Follow-up</Badge>}
                {question?.topic && <span className="text-ink-3">{question.topic}</span>}
              </div>
              <h2 className="mt-4 font-serif text-[1.5rem] leading-snug text-ink sm:text-[1.75rem]">{question?.question}</h2>
            </div>

            <div className="border-t border-line bg-paper/60 px-6 py-5 sm:px-8" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  {stage === 'speaking' && <VoiceBars />}
                  {stage === 'listening' && voiceMode && <VoiceBars level={listen.level} />}
                  {(stage === 'processing' || stage === 'finishing') && <Spinner className="h-5 w-5 text-ink-2" />}
                  {stage === 'listening' && voiceMode && <Mic className="h-4 w-4 shrink-0 text-bad" />}
                  <div className="min-w-0">
                    <p role="status" className="text-sm font-medium text-ink">{statusLine}</p>
                    <p className="text-xs text-ink-3">
                      {stage === 'speaking' && 'Listen to the question. Your answer starts after the chime.'}
                      {stage === 'listening' && voiceMode && listen.countdown === null && `${formatClock(listen.seconds)} · speak naturally, then pause or select Next`}
                      {stage === 'listening' && voiceMode && listen.countdown !== null && `Moving on in ${listen.countdown}… keep talking to continue`}
                      {stage === 'listening' && !voiceMode && 'Type your answer, then submit.'}
                      {stage === 'processing' && 'Evaluating your answer and preparing what comes next.'}
                      {stage === 'finishing' && 'Saving the recording and preparing your report.'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stage === 'speaking' && (
                    <button className="ghost-btn !py-2 text-[13px]" onClick={() => stopSpeaking()}>
                      <SkipForward className="h-4 w-4" /> Skip to answer
                    </button>
                  )}
                  {stage === 'listening' && (
                    <button className="ghost-btn !py-2 text-[13px]" onClick={repeatQuestion}>
                      <RotateCcw className="h-4 w-4" /> Repeat question
                    </button>
                  )}
                  {stage === 'listening' && voiceMode && (
                    <button className="primary-btn" onClick={finishAnswer}>
                      {isLastTurn ? 'Finish Interview' : 'Next Question'} <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {stage === 'listening' && voiceMode && listen.noVoice && (
                <Notice tone="warn" className="mt-4">We can&apos;t hear you. Check that your microphone is on and unmuted, or select Next to skip this question.</Notice>
              )}
              {stage === 'listening' && voiceMode && listen.countdown !== null && (
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${(listen.countdown / 3) * 100}%` }} />
                </div>
              )}

              {stage === 'listening' && !voiceMode && (
                <div className="mt-4">
                  <textarea
                    aria-label="Your answer"
                    rows="7"
                    value={typedAnswer}
                    onChange={(event) => setTypedAnswer(event.target.value)}
                    className="input-field resize-y !text-[15px] leading-relaxed"
                    placeholder="Explain your approach, the concepts involved and the trade-offs you would weigh…"
                  />
                  <div className="mt-3 flex justify-end">
                    <button className="primary-btn" onClick={finishAnswer} disabled={!typedAnswer.trim()}>
                      {isLastTurn ? 'Finish Interview' : 'Submit Answer'} <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {stage === 'retry' && (
                <div className="mt-4 space-y-3">
                  <Notice tone="warn" role="alert">{flowError}</Notice>
                  <button className="primary-btn" onClick={finishAnswer}>
                    {responseIdRef.current ? 'Retry Next Question' : 'Retry Submission'}
                  </button>
                </div>
              )}
            </div>
          </Panel>
        </section>

        {/* Camera, engagement and status */}
        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
          <Panel i={3} className="overflow-hidden">
            <div className="relative aspect-video bg-ink">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center text-center text-paper/60">
                  <div><Camera className="mx-auto h-6 w-6" strokeWidth={1.5} /><p className="mt-2 text-[13px]">Camera preview unavailable</p></div>
                </div>
              )}
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-medium text-paper backdrop-blur">
                <span className="pulse-dot h-2 w-2 rounded-full bg-[#e0796d]" /> Recording interview
              </div>
            </div>
            {(mediaError || recordingIssue) && (
              <div className="space-y-2 p-4">
                {mediaError && <Notice tone="warn">{mediaError}</Notice>}
                {recordingIssue && <Notice tone="warn">Part of the recording is still uploading; it retries automatically.</Notice>}
              </div>
            )}
          </Panel>

          <BehaviorMonitor
            videoRef={videoRef}
            active={cameraReady}
            segmentKey={currentTurn}
            onMetricsChange={(sessionMetrics, answerMetrics) => {
              visionMetricsRef.current = sessionMetrics;
              answerVisionRef.current = answerMetrics;
            }}
          />

          <Panel i={5} className="p-5">
            <h2 className="text-[15px] font-semibold text-ink">Live status</h2>
            <ul className="mt-3 divide-y divide-line">
              {[
                ['Camera', cameraReady ? 'Active' : 'Unavailable', cameraReady],
                ['Microphone', microphoneReady ? 'Active' : 'Unavailable', microphoneReady],
                ['Answer mode', voiceMode ? 'Spoken' : 'Typed', true],
                ['Answered', `${responses.filter((item) => item.completed).length} of ${maxTurns}`, true],
                ['Integrity warnings', `${violations} of ${maxViolations}`, violations === 0],
              ].map(([label, value, ok]) => (
                <li key={label} className="flex items-center justify-between py-2.5 text-[13px]">
                  <span className="text-ink-2">{label}</span>
                  <span className={`flex items-center gap-2 ${ok ? 'text-ink' : 'text-warn'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-ok' : 'bg-warn'}`} />{value}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
