import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Camera, Code2, Mic, RotateCcw, SkipForward,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BehaviorMonitor from '../components/BehaviorMonitor';
import CodingWorkspace from '../components/CodingWorkspace';
import {
  IdentityEnrolment, IntegrityOverlays, RulesStep, TerminatedScreen, VoiceBars,
} from '../components/IntegrityScreens';
import {
  Badge, FlowSteps, Notice, Panel, Skeleton, Spinner,
} from '../components/ui';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { speak, stopSpeaking, playTurnChime } from '../services/speech';
import { createVoiceMonitor } from '../services/voiceActivity';
import { startAnswerRecording } from '../services/answerRecorder';
import { startSessionRecording } from '../services/sessionRecorder';
import { exitFullscreen, fullscreenSupported, hasMultipleDisplays } from '../services/proctoring';
import { createAnswerSignals, isVirtualDevice } from '../services/malpracticeSignals';
import { useIntegrityGuard } from '../hooks/useIntegrityGuard';
import { STORAGE_KEYS, clearInterviewProgress, readAnswerMode, readCodingRound } from '../utils/interviewJourney';

// -------------------------------------------------------------
// BLOCK 0: Interview pacing (voice mode)
// -------------------------------------------------------------
// Once the candidate has spoken, SILENCE_TO_ADVANCE_MS of silence moves on
// to the next question; a countdown shows for the last two seconds and
// speaking again cancels it.
const SILENCE_TO_ADVANCE_MS = 3000;
const COUNTDOWN_FROM_MS = 1000;
// Spoken at least this long before silence can end an answer.
const MIN_SPEECH_MS = 1200;
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
  const pendingRef = useRef(null);          // answer awaiting submit
  const pendingAudioRef = useRef(null);     // recorded answer awaiting transcription
  const answerStartRef = useRef(0);
  const noSpeechRetriesRef = useRef(0);
  const busyRef = useRef(false);
  const unmountedRef = useRef(false);
  const startRequestRef = useRef(null);
  const resumeRef = useRef(null);           // /state payload when resuming
  const beganAtRef = useRef(null);
  const turnRef = useRef(1);
  const stageRef = useRef('loading');
  const answerSignalsRef = useRef(null);    // this answer's integrity signals

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
  const [virtualDevice, setVirtualDevice] = useState(null);
  const multipleDisplays = useMemo(() => hasMultipleDisplays(), []);

  const targetRole = useMemo(() => localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer', []);
  const targetJd = useMemo(() => localStorage.getItem(STORAGE_KEYS.jobDescription) || '', []);
  const isLastTurn = currentTurn >= maxTurns;
  const coding = question?.kind === 'coding';

  // Proctoring and malpractice detection. Ending early (too many warnings
  // or staying away) saves what was answered and goes to the report.
  const guard = useIntegrityGuard({
    videoRef,
    monitorRef,
    turnRef,
    gazeWarnings: true,
    context: () => ({
      part: sessionRef.current?.part ?? null,
      at: sessionRef.current ? sessionRef.current.elapsedSeconds() : null,
    }),
    onTerminate: async (reason) => {
      setStage('terminated');
      stopSpeaking();
      answerRecRef.current?.cancel?.();
      monitorRef.current?.stop();
      localStorage.setItem(STORAGE_KEYS.endedEarly, reason || 'violations');
      const duration = beganAtRef.current ? Math.round((Date.now() - beganAtRef.current) / 1000) : 0;
      localStorage.setItem(DURATION_KEY, String(duration));
      if (visionMetricsRef.current) {
        localStorage.setItem(STORAGE_KEYS.visionMetrics, JSON.stringify(visionMetricsRef.current));
      }
      await (sessionRef.current?.stop() ?? Promise.resolve());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (!unmountedRef.current) setTimeout(() => navigate('/interview-complete'), 2500);
    },
  });

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
            const codingRound = readCodingRound();
            const resumeText = localStorage.getItem(STORAGE_KEYS.resumeText) || '';
            const options = {
              ...(codingRound === null ? {} : { codingRound }),
              ...(resumeText ? { resumeText } : {}),
            };
            return api.startInterview(
              localStorage.getItem(STORAGE_KEYS.roleTitle) || 'Software Engineer', user?.uid || null,
              localStorage.getItem(STORAGE_KEYS.jobDescription) || null,
              user?.email || null, user?.displayName || null, 5, 'standard', answerMode,
              ...(Object.keys(options).length ? [options] : []),
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
        guard.configure({
          interviewId: data.interview_id,
          maxViolations: data.proctoring?.max_violations || 3,
          violations: data.proctoring?.violations || 0,
          maxAwaySeconds: data.proctoring?.max_away_seconds || 5,
          identity: data.identity || { enabled: false, enrolled: false },
        });
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
        const virtual = [...stream.getVideoTracks(), ...stream.getAudioTracks()]
          .map((track) => track?.label).find(isVirtualDevice);
        if (virtual) setVirtualDevice(virtual);
        setCameraReady(stream.getVideoTracks().length > 0);
        setMicrophoneReady(stream.getAudioTracks().length > 0);
      } catch (error) {
        if (!unmountedRef.current) setMediaError(error?.message || 'Camera and microphone access is required.');
      }
    })();
    return () => {
      unmountedRef.current = true;
      guard.stop();
      exitFullscreen();
      stopSpeaking();
      monitorRef.current?.stop();
      answerRecRef.current?.cancel?.();
      sessionRef.current?.stop({ timeoutMs: 5000 });
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useEffect(() => { stageRef.current = stage; }, [stage]);

  // Keep the journey in storage for the completion page and the report.
  useEffect(() => {
    if (interviewId && responses.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ interviewId, current_turn: currentTurn, max_turns: maxTurns, responses }));
    }
  }, [interviewId, currentTurn, maxTurns, responses]);

  // -------------------------------------------------------------
  // BLOCK 5: The interview loop
  // -------------------------------------------------------------
  // speak question → chime → listen (or code in the VPL) → (Next | silence |
  // time limit | Submit) → transcribe → grade silently → next question …
  const startAnswer = useCallback((turnQuestion) => {
    if (unmountedRef.current || guard.isTerminated()) return;
    const codingTurn = turnQuestion?.kind === 'coding';
    answerStartRef.current = sessionRef.current?.elapsedSeconds() ?? 0;
    setListen({ level: 0, countdown: null, seconds: 0, noVoice: false });
    pendingAudioRef.current = null;
    answerSignalsRef.current = createAnswerSignals({ voiceMode: voiceMode && !codingTurn, now: performance.now() });
    guard.newAnswer();
    monitorRef.current?.reset();
    if (voiceMode && !codingTurn) answerRecRef.current = startAnswerRecording(streamRef.current);
    setStage(codingTurn ? 'coding' : 'listening');
  }, [voiceMode, guard]);

  const askQuestion = useCallback(async (nextQuestion, id) => {
    if (unmountedRef.current || guard.isTerminated()) return;
    setQuestion(nextQuestion);
    setTypedAnswer('');
    noSpeechRetriesRef.current = 0;
    setStage('speaking');
    await speak({ interviewId: id, item: `question-${nextQuestion.index}` },
      `Question ${nextQuestion.index}. ${nextQuestion.question}`);
    if (unmountedRef.current || guard.isTerminated()) return;
    playTurnChime();
    startAnswer(nextQuestion);
  }, [startAnswer, guard]);

  const finishInterview = useCallback(async (id) => {
    if (guard.isTerminated()) return;
    guard.stop();
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
    await guard.flushEvents();
    await exitFullscreen();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (!unmountedRef.current) navigate('/interview-complete');
  }, [navigate, guard]);

  // Submit (once) and advance. Retries reuse the accepted response.
  const submitAndAdvance = useCallback(async (id, turnQuestion) => {
    const pending = pendingRef.current || {};
    if (!responseIdRef.current) {
      const saved = turnQuestion.kind === 'coding'
        ? await api.submitCode(id, {
          questionIndex: turnQuestion.index, language: pending.language, code: pending.code,
          answerSignals: pending.signals || null,
        })
        : await api.submitAnswer(id, {
          questionIndex: turnQuestion.index,
          questionText: turnQuestion.question,
          candidateAnswer: pending.text ?? '',
          videoBlob: null,
          visionMetrics: answerVisionRef.current,
          recording: sessionRef.current
            ? { part: sessionRef.current.part, start: answerStartRef.current, end: sessionRef.current.elapsedSeconds() }
            : null,
          answerSignals: pending.signals || null,
        });
      if (!saved?.response_id) throw new Error('Missing response identifier');
      responseIdRef.current = saved.response_id;
      const answer = turnQuestion.kind === 'coding' ? pending.code : pending.text ?? '';
      setResponses((current) => current.map((item, index) => (index === current.length - 1
        ? { ...item, answer, completed: true, response_id: saved.response_id, evaluation: saved.evaluation }
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
  // `codeAnswer` ({ language, code }) comes from the VPL on coding turns.
  const finishAnswer = useCallback(async (codeAnswer = null) => {
    if (busyRef.current || !interviewId || !question || guard.isTerminated()) return;
    busyRef.current = true;
    setFlowError('');
    setStage('processing');
    try {
      if (!pendingRef.current && !responseIdRef.current) {
        if (question.kind === 'coding') {
          const code = codeAnswer?.code ?? '';
          pendingRef.current = {
            language: codeAnswer?.language || 'python', code,
            signals: answerSignalsRef.current?.summary(code.length) || null,
          };
        } else {
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
                guard.handleServerResult(result?.identity);
              } catch (error) {
                if (error?.status === 422 && noSpeechRetriesRef.current < 1) {
                  // Nothing intelligible was heard: ask once more.
                  noSpeechRetriesRef.current += 1;
                  await speak({ phrase: 'no_speech' }, "Sorry, I couldn't hear an answer. Please try answering again.");
                  busyRef.current = false;
                  startAnswer(question);
                  return;
                }
                if (error?.status !== 422) throw error;
              }
            }
          } else {
            text = typedAnswer.trim();
            speak({ phrase: 'thanks' }, '');
          }
          pendingRef.current = { text, signals: answerSignalsRef.current?.summary(text.length) || null };
        }
        pendingAudioRef.current = null;
      }
      await submitAndAdvance(interviewId, question);
    } catch {
      setFlowError(responseIdRef.current
        ? 'Your answer is saved. Retry to continue to the next question.'
        : 'We could not save your answer. Check your connection and retry; nothing has been lost.');
      setStage('retry');
    } finally {
      busyRef.current = false;
    }
  }, [interviewId, question, voiceMode, typedAnswer, startAnswer, submitAndAdvance, guard]);

  // After the rules and the identity check: the interview itself.
  const proceed = useCallback(async () => {
    const resumed = resumeRef.current;
    guard.startSnapshots();
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
  }, [interviewId, question, targetRole, askQuestion, finishAnswer, guard]);

  // The candidate's click also unlocks audio playback (browser autoplay rules)
  // and fullscreen (both need a user gesture).
  const begin = useCallback(async () => {
    if (!interviewId || busyRef.current) return;
    beganAtRef.current = Date.now();
    const resumed = resumeRef.current;
    const part = (resumed?.recording_parts?.length ? Math.max(...resumed.recording_parts) : 0) + 1;
    if (streamRef.current) {
      sessionRef.current = startSessionRecording({
        stream: streamRef.current, interviewId, part,
        onUploadError: () => setRecordingIssue(true),
      });
      // Needed in both modes: enrolment and lip-movement checks use it.
      monitorRef.current = createVoiceMonitor(streamRef.current);
    }
    await guard.start({ multipleDisplays });
    if (resumed) {
      if (guard.needsEnrolment()) setStage('enrolling');
      else await proceed();
      return;
    }
    setStage('rules');
  }, [interviewId, multipleDisplays, guard, proceed]);

  const afterRules = useCallback(async () => {
    if (guard.needsEnrolment()) setStage('enrolling');
    else await proceed();
  }, [guard, proceed]);

  const afterEnrolment = useCallback(async (identity) => {
    guard.setIdentity(identity);
    await proceed();
  }, [guard, proceed]);

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
      // While the candidate is away (or reading a warning) the answer cannot end by silence.
      if (guard.isPaused()) return;
      const snapshot = monitorRef.current?.snapshot();
      if (snapshot?.speaking) answerSignalsRef.current?.markActivity(performance.now());
      if (!snapshot) {
        const seconds = (sessionRef.current?.elapsedSeconds() ?? 0) - answerStartRef.current;
        setListen((current) => ({ ...current, seconds }));
        if (seconds * 1000 >= MAX_ANSWER_MS) finishAnswer();
        return;
      }
      const spoke = snapshot.speechMs >= MIN_SPEECH_MS;
      const quiet = spoke && !snapshot.speaking ? snapshot.silenceMs : 0;
      const countdown = quiet >= COUNTDOWN_FROM_MS ? Math.max(0, Math.ceil((SILENCE_TO_ADVANCE_MS - quiet) / 1000)) : null;
      setListen({
        level: snapshot.level,
        countdown,
        seconds: snapshot.elapsedMs / 1000,
        noVoice: !spoke && snapshot.elapsedMs > NO_VOICE_HINT_MS,
      });
      if ((spoke && quiet >= SILENCE_TO_ADVANCE_MS) || snapshot.elapsedMs >= MAX_ANSWER_MS) finishAnswer();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [stage, voiceMode, finishAnswer, guard]);
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
                  {voiceMode ? 'Answer out loud. Select Next when you finish, or stay silent for 3 seconds and the interview moves on.' : 'Type each answer and submit it.'}
                </li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />Coding questions open a code editor with test cases.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />The whole interview is recorded on camera. Your report appears at the end.</li>
                <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-bad" />
                  <span>
                    <span className="font-medium text-ink">Stay in the interview, alone.</span>{' '}
                    {canFullscreen ? 'It runs in fullscreen. ' : ''}The rules are read out next; {guard.maxViolations} warnings, or staying away {guard.maxAwaySeconds} seconds, ends the interview.
                  </span>
                </li>
              </ul>
              {virtualDevice && (
                <Notice tone="warn" className="mt-6">
                  &ldquo;{virtualDevice}&rdquo; is a virtual camera or microphone, which is not allowed. Choose your real devices in the browser&apos;s site settings and reload the page.
                </Notice>
              )}
              {multipleDisplays && <Notice tone="warn" className="mt-6">A second display is connected. Disconnect it before starting; this is recorded in your report.</Notice>}
              {resumed && <Notice className="mt-6">Your earlier answers are saved. The interview continues from question {currentTurn}.</Notice>}
              {mediaError && <Notice tone="warn" className="mt-6">{mediaError}</Notice>}
              {voiceBlocked && !mediaError && <Notice tone="warn" className="mt-6">Waiting for microphone access…</Notice>}
              <button onClick={begin} disabled={voiceBlocked || Boolean(virtualDevice)} className="primary-btn mt-8 !px-6 !py-3.5 text-[15px]">
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

  if (stage === 'rules') {
    return (
      <>
        <IntegrityOverlays guard={guard} />
        <RulesStep maxViolations={guard.maxViolations} maxAwaySeconds={guard.maxAwaySeconds} onContinue={afterRules} />
        <video ref={videoRef} autoPlay muted playsInline className="sr-only" aria-hidden="true" />
      </>
    );
  }

  if (stage === 'enrolling') {
    return (
      <>
        <IntegrityOverlays guard={guard} />
        <IdentityEnrolment interviewId={interviewId} videoRef={videoRef} streamRef={streamRef} monitorRef={monitorRef} onDone={afterEnrolment} />
      </>
    );
  }

  if (stage === 'terminated') {
    return (
      <TerminatedScreen
        reason={guard.terminated}
        violations={guard.violations}
        maxAwaySeconds={guard.maxAwaySeconds}
        detail="Your answers so far are saved and graded; unanswered questions score 0."
      />
    );
  }

  const statusLine = {
    speaking: 'Interviewer is asking…',
    listening: voiceMode ? 'Listening' : 'Your answer',
    coding: 'Coding question',
    processing: 'Thinking…',
    retry: 'Connection problem',
    finishing: 'Wrapping up…',
  }[stage];

  const status = (
    <Panel i={5} className="p-5">
      <h2 className="text-[15px] font-semibold text-ink">Live status</h2>
      <ul className="mt-3 divide-y divide-line">
        {[
          ['Camera', cameraReady ? 'Active' : 'Unavailable', cameraReady],
          ['Microphone', microphoneReady ? 'Active' : 'Unavailable', microphoneReady],
          ['Answer mode', voiceMode ? 'Spoken' : 'Typed', true],
          ['Answered', `${responses.filter((item) => item.completed).length} of ${maxTurns}`, true],
          ['Identity', guard.enrolled ? 'Verified at start' : 'Not checked', guard.enrolled],
          ['Integrity warnings', `${guard.violations} of ${guard.maxViolations}`, guard.violations === 0],
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
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <IntegrityOverlays guard={guard} />

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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-5">
          {guard.attention && !guard.warning && !guard.away && (
            <Notice tone="warn" role="alert">{guard.attention.message}</Notice>
          )}
          {/* The interviewer: question + what is happening now */}
          <Panel i={1} as="article" key={`question-${currentTurn}`} className="overflow-hidden">
            {coding && stage === 'coding' ? (
              <div className="p-5 sm:p-6">
                <CodingWorkspace
                  interviewId={interviewId}
                  question={question}
                  signals={answerSignalsRef.current}
                  onInjected={(chars) => guard.flagOnce('text_injected', { chars, source: 'editor' })}
                  onSubmit={(answer) => finishAnswer(answer)}
                />
              </div>
            ) : (
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="num font-mono text-ink-3">Q{currentTurn}</span>
                  <span className="text-ink-4">·</span>
                  <Badge>{question?.difficulty?.replace(/^./, (c) => c.toUpperCase())}</Badge>
                  {coding && <Badge tone="ink"><Code2 className="h-3 w-3" /> Coding</Badge>}
                  {question?.is_follow_up && <Badge tone="ink">AI Follow-up</Badge>}
                  {question?.topic && <span className="text-ink-3">{question.topic}</span>}
                </div>
                <h2 className="mt-4 font-serif text-[1.5rem] leading-snug text-ink sm:text-[1.75rem]">
                  {coding ? question.coding?.title : question?.question}
                </h2>
                {coding && <p className="mt-2 text-sm text-ink-2">{question.coding?.statement}</p>}
              </div>
            )}

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
                      {stage === 'speaking' && (coding ? 'Listen to the problem. The code editor opens after the chime.' : 'Listen to the question. Your answer starts after the chime.')}
                      {stage === 'listening' && voiceMode && listen.countdown === null && `${formatClock(listen.seconds)} · speak naturally; 3 seconds of silence moves on`}
                      {stage === 'listening' && voiceMode && listen.countdown !== null && `Moving on in ${listen.countdown}… keep talking to continue`}
                      {stage === 'listening' && !voiceMode && 'Type your answer, then submit.'}
                      {stage === 'coding' && 'Write your solution, run the examples, then submit. Paste is disabled.'}
                      {stage === 'processing' && (coding ? 'Running every test case and reviewing your code.' : 'Evaluating your answer and preparing what comes next.')}
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
                    <button className="primary-btn" onClick={() => finishAnswer()}>
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
                  <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${(listen.countdown / 2) * 100}%` }} />
                </div>
              )}

              {stage === 'listening' && !voiceMode && (
                <div className="mt-4">
                  <textarea
                    aria-label="Your answer"
                    rows="7"
                    value={typedAnswer}
                    onKeyDown={(event) => {
                      answerSignalsRef.current?.typing.keydown(event);
                      answerSignalsRef.current?.markActivity();
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      const injected = answerSignalsRef.current?.typing.input(event.nativeEvent, value.length - typedAnswer.length);
                      if (injected) guard.flagOnce('text_injected', { chars: value.length - typedAnswer.length });
                      setTypedAnswer(value);
                    }}
                    className="input-field resize-y !text-[15px] leading-relaxed"
                    placeholder="Explain your approach, the concepts involved and the trade-offs you would weigh…"
                  />
                  <div className="mt-3 flex justify-end">
                    <button className="primary-btn" onClick={() => finishAnswer()} disabled={!typedAnswer.trim()}>
                      {isLastTurn ? 'Finish Interview' : 'Submit Answer'} <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {stage === 'retry' && (
                <div className="mt-4 space-y-3">
                  <Notice tone="warn" role="alert">{flowError}</Notice>
                  <button className="primary-btn" onClick={() => finishAnswer()}>
                    {responseIdRef.current ? 'Retry Next Question' : 'Retry Submission'}
                  </button>
                </div>
              )}
            </div>
          </Panel>
        </section>

        {/* Camera, engagement and status */}
        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
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
            sampleIntervalMs={100}
            onFrame={(observation, time) => guard.handleFrame(observation, time, {
              signals: answerSignalsRef.current,
              listening: stageRef.current === 'listening' || stageRef.current === 'coding',
            })}
            onMetricsChange={(sessionMetrics, answerMetrics) => {
              visionMetricsRef.current = sessionMetrics;
              answerVisionRef.current = answerMetrics;
            }}
          />

          {status}
        </aside>
      </div>
    </div>
  );
}
