import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Camera, Code2, Gamepad2, Lightbulb, ShieldCheck, Trophy,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import BehaviorMonitor from '../components/BehaviorMonitor';
import CodingWorkspace from '../components/CodingWorkspace';
import {
  IdentityEnrolment, IntegrityOverlays, RulesStep, TerminatedScreen,
} from '../components/IntegrityScreens';
import {
  CountUp, EmptyState, Notice, Panel, Spinner,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { exitFullscreen, hasMultipleDisplays } from '../services/proctoring';
import { createVoiceMonitor } from '../services/voiceActivity';
import { createAnswerSignals, isVirtualDevice } from '../services/malpracticeSignals';
import { stopSpeaking } from '../services/speech';
import { useIntegrityGuard } from '../hooks/useIntegrityGuard';
import { STORAGE_KEYS } from '../utils/interviewJourney';

// -------------------------------------------------------------
// Ranked Arena game screen
// -------------------------------------------------------------
// Setup comes from the Arena page through router state (practice area,
// ranking category, coding challenges). Flow: Start (fullscreen) → rules →
// identity check → per level: answer (or code in the VPL) → submit (graded
// once, retry-safe) → advance (XP, streak, next level) → result card.
// Ranked play is proctored like an interview: warnings, the away limit and
// malpractice detection. Ending early (staying away or too many warnings)
// scores the remaining levels 0 and costs rating points.
const difficultyLabel = (value) => (value ? value[0].toUpperCase() + value.slice(1) : '');

export default function ArenaPlay() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const config = state?.arenaConfig;
  const valid = config?.interview_mode === 'game'
    && typeof config.role_title === 'string' && config.role_title.trim()
    && typeof config.topic === 'string' && config.topic.trim();
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [game, setGame] = useState({ total_xp: 0, current_streak: 0, remaining_hints: 1 });
  const [hint, setHint] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [virtualDevice, setVirtualDevice] = useState(null);
  const startRef = useRef(null);
  const responseRef = useRef(null);
  const submittedPayloadRef = useRef(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const monitorRef = useRef(null);
  const turnRef = useRef(1);
  const beganAtRef = useRef(null);
  const signalsRef = useRef(null);
  const sessionIdRef = useRef(null);
  const multipleDisplays = useMemo(() => hasMultipleDisplays(), []);
  const busy = ['loading', 'submitting', 'advancing', 'hint'].includes(phase);
  const locked = busy || Boolean(submittedPayloadRef.current);
  const coding = question?.kind === 'coding';

  const guard = useIntegrityGuard({
    videoRef,
    monitorRef,
    turnRef,
    context: () => ({ at: beganAtRef.current ? (Date.now() - beganAtRef.current) / 1000 : null }),
    onTerminate: async (reason) => {
      setPhase('terminated');
      stopSpeaking();
      monitorRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      try {
        await api.endArena(sessionIdRef.current, reason);
      } catch {
        // The results page retries loading; the session stays recorded.
      }
      if (mountedRef.current) setTimeout(() => navigate('/arena/results'), 2500);
    },
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Start the Arena session once; the shared promise survives StrictMode
  // effect replays so only one session is created.
  useEffect(() => {
    if (!valid) return;
    let active = true;
    setPhase('loading');
    setError('');
    if (!startRef.current) {
      const options = {
        ...(config.category ? { arenaCategory: config.category } : {}),
        ...(typeof config.coding === 'boolean' ? { codingRound: config.coding } : {}),
      };
      startRef.current = api.startInterview(config.role_title, user?.uid || null,
        config.job_description || `Practice ${config.topic} interview questions.`,
        user?.email || null, user?.displayName || null, 6, 'game',
        ...(Object.keys(options).length ? ['typed', options] : []));
    }
    startRef.current.then((data) => {
      if (!active) return;
      if (data.interview_mode !== 'game' || !data.question) throw new Error('Invalid Arena session');
      sessionStorage.setItem(STORAGE_KEYS.arenaInterviewId, data.interview_id);
      sessionIdRef.current = data.interview_id;
      guard.configure({
        interviewId: data.interview_id,
        maxViolations: data.proctoring?.max_violations || 3,
        maxAwaySeconds: data.proctoring?.max_away_seconds || 5,
        identity: data.identity || { enabled: false, enrolled: false },
      });
      setSession(data);
      setQuestion(data.question);
      turnRef.current = data.question.index;
      setPhase('ready');
    }).catch(() => {
      if (!active) return;
      startRef.current = null;
      setError('Unable to start Arena. Check your connection and retry.');
      setPhase('start-error');
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, attempt]);

  // Camera and microphone (ranked play is proctored).
  useEffect(() => {
    if (!valid) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access is required for ranked Arena.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const virtual = [...stream.getVideoTracks(), ...stream.getAudioTracks()].map((t) => t?.label).find(isVirtualDevice);
        if (virtual) setVirtualDevice(virtual);
        setCameraReady(stream.getVideoTracks().length > 0);
      } catch (err) {
        if (!cancelled) setMediaError(err?.message || 'Camera and microphone access is required for ranked Arena.');
      }
    })();
    return () => {
      cancelled = true;
      guard.stop();
      exitFullscreen();
      stopSpeaking();
      monitorRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid]);

  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.()?.catch?.(() => {});
    }
  });

  const beginLevel = useCallback(() => {
    signalsRef.current = createAnswerSignals({ voiceMode: false, now: performance.now() });
    guard.newAnswer();
    monitorRef.current?.reset();
  }, [guard]);

  const proceed = useCallback(() => {
    guard.startSnapshots();
    beginLevel();
    setPhase('answering');
  }, [guard, beginLevel]);

  async function begin() {
    beganAtRef.current = Date.now();
    if (streamRef.current) monitorRef.current = createVoiceMonitor(streamRef.current);
    await guard.start({ multipleDisplays });
    setPhase('rules');
  }

  // Submit the answer (if not yet accepted), then advance to get the result.
  async function submit(codeAnswer = null) {
    if (busyRef.current || result || guard.isTerminated()) return;
    if (!responseRef.current && !coding && !answer.trim()) return;
    busyRef.current = true;
    setError('');
    try {
      if (!responseRef.current) {
        setPhase('submitting');
        // A network failure may hide a committed answer. Always replay the same
        // payload so the backend can return its original response ID.
        if (coding) {
          submittedPayloadRef.current ||= {
            questionIndex: question.index, language: codeAnswer?.language || 'python', code: codeAnswer?.code || '',
            answerSignals: signalsRef.current?.summary((codeAnswer?.code || '').length) || null,
          };
        } else {
          submittedPayloadRef.current ||= {
            questionIndex: question.index, questionText: question.question,
            candidateAnswer: answer, videoBlob: null,
            ...(signalsRef.current ? { answerSignals: signalsRef.current.summary(answer.length) } : {}),
          };
        }
        const saved = coding
          ? await api.submitCode(session.interview_id, submittedPayloadRef.current)
          : await api.submitAnswer(session.interview_id, submittedPayloadRef.current);
        if (!mountedRef.current) return;
        if (!saved.response_id) throw new Error('Missing response ID');
        responseRef.current = saved.response_id;
      }
      setPhase('advancing');
      const next = await api.nextQuestion(session.interview_id, responseRef.current);
      if (!mountedRef.current) return;
      if (!next.game || (!next.is_complete && !next.next_question)) throw new Error('Invalid game result');
      setGame(next.game);
      setResult(next);
      setPhase('result');
      if (next.is_complete) {
        guard.stop();
        await guard.flushEvents();
        await exitFullscreen();
      }
    } catch {
      if (!mountedRef.current) return;
      setPhase(responseRef.current ? 'advance-error' : 'submit-error');
      setError(responseRef.current
        ? 'Your answer is saved. Retry advancement to retrieve your result; the answer will not be submitted again.'
        : 'Submission could not be confirmed. Your answer is locked and preserved; retry will send the same answer safely.');
    } finally {
      busyRef.current = false;
    }
  }

  // Spend the single session hint on the current, unanswered level.
  async function requestHint() {
    if (busyRef.current || locked || game.remaining_hints === 0) return;
    busyRef.current = true;
    setPhase('hint');
    setError('');
    try {
      const data = await api.useHint(session.interview_id, question.index);
      if (!mountedRef.current) return;
      setHint(data.hint);
      setGame((previous) => ({ ...previous, remaining_hints: data.remaining_hints }));
    } catch (err) {
      if (!mountedRef.current) return;
      // A rejected repeat means the backend already consumed this session's hint.
      if (err.status === 409) setGame((previous) => ({ ...previous, remaining_hints: 0 }));
      setError('The hint could not be retrieved. You can continue answering.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPhase('answering');
    }
  }

  // Move to the next level, or to the results page after the Boss Round.
  function nextChallenge() {
    if (result.is_complete) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      navigate('/arena/results');
      return;
    }
    setSession((previous) => ({ ...previous, current_turn: result.current_turn, max_turns: result.max_turns }));
    setQuestion(result.next_question);
    turnRef.current = result.next_question.index;
    setAnswer('');
    setHint('');
    responseRef.current = null;
    submittedPayloadRef.current = null;
    setResult(null);
    beginLevel();
    setPhase('answering');
  }

  if (!valid) return (
    <Panel className="mx-auto max-w-xl">
      <EmptyState
        icon={Gamepad2}
        title="Interview Arena"
        headingLevel="h1"
        action={<Link to="/arena" className="primary-btn">Choose Practice Area</Link>}
      >
        Choose a practice area to start your challenge.
      </EmptyState>
    </Panel>
  );
  if (!question) return (
    <Panel className="mx-auto max-w-xl p-8">
      <h1 className="font-serif text-3xl text-ink">Preparing Interview Arena</h1>
      {phase === 'loading' ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-2"><Spinner />Preparing your first challenge…</p>
      ) : (
        <>
          <p role="alert" className="my-4 text-sm text-ink-2">{error}</p>
          <button className="primary-btn" onClick={() => setAttempt((n) => n + 1)}>Retry Start</button>
        </>
      )}
    </Panel>
  );

  if (phase === 'ready') return (
    <Panel className="mx-auto max-w-3xl overflow-hidden">
      <div className="grid sm:grid-cols-[minmax(0,1fr)_240px]">
        <div className="p-7 sm:p-9">
          <p className="flex items-center gap-2 text-[13px] text-ink-3"><Trophy className="h-4 w-4" /> Ranked Arena · {config.topic}</p>
          <h1 className="mt-2 font-serif text-[2.4rem] leading-[1.05] tracking-[-0.02em] text-ink">Ready to play?</h1>
          <ul className="mt-6 space-y-2.5 text-sm text-ink-2">
            <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />Six levels; the last one is the Boss Round. One hint per session.</li>
            <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />Your result changes your rating overall and in this category.</li>
            {session?.coding_round && <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />Levels 3 and 5 are coding challenges in the code editor.</li>}
            <li className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-bad" />
              <span><span className="font-medium text-ink">Proctored like an interview.</span> Each warning costs rating points; leaving for {guard.maxAwaySeconds} seconds or {guard.maxViolations} warnings ends the game.</span>
            </li>
          </ul>
          {virtualDevice && <Notice tone="warn" className="mt-6">&ldquo;{virtualDevice}&rdquo; is a virtual camera or microphone, which is not allowed. Choose your real devices and reload.</Notice>}
          {mediaError && <Notice tone="warn" className="mt-6">{mediaError}</Notice>}
          <button className="primary-btn mt-8 !px-6 !py-3.5 text-[15px]" onClick={begin} disabled={Boolean(virtualDevice)}>
            Start Ranked Arena <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <div className="relative hidden bg-ink sm:block">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          {!cameraReady && <div className="absolute inset-0 grid place-items-center text-paper/60"><Camera className="h-6 w-6" /></div>}
        </div>
      </div>
    </Panel>
  );

  if (phase === 'rules') return (
    <>
      <IntegrityOverlays guard={guard} sessionLabel="Arena" />
      <RulesStep arena maxViolations={guard.maxViolations} maxAwaySeconds={guard.maxAwaySeconds}
        onContinue={() => (guard.needsEnrolment() ? setPhase('enrolling') : proceed())} />
      <video ref={videoRef} autoPlay muted playsInline className="sr-only" aria-hidden="true" />
    </>
  );

  if (phase === 'enrolling') return (
    <>
      <IntegrityOverlays guard={guard} sessionLabel="Arena" />
      <IdentityEnrolment interviewId={session.interview_id} videoRef={videoRef} streamRef={streamRef} monitorRef={monitorRef}
        onDone={(identity) => { guard.setIdentity(identity); proceed(); }} />
    </>
  );

  if (phase === 'terminated') return (
    <TerminatedScreen reason={guard.terminated} violations={guard.violations} maxAwaySeconds={guard.maxAwaySeconds}
      sessionLabel="Arena" detail="Unplayed levels score 0 and your rating drops." />
  );

  const boss = Boolean(question.boss_round);
  const totalLevels = session.max_turns || 6;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <IntegrityOverlays guard={guard} sessionLabel="Arena" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {/* HUD */}
          <header
            key={`hud-${session.current_turn}`}
            className={`reveal rounded-panel border p-6 sm:p-7 ${boss ? 'border-ink bg-ink text-paper' : 'border-line bg-surface'}`}
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className={`flex items-center gap-2 text-[13px] ${boss ? 'text-paper/55' : 'text-ink-3'}`}>
                  <Gamepad2 aria-hidden="true" className="h-4 w-4" />
                  Challenge {session.current_turn} of {session.max_turns} · {session.role_title || config.role_title}
                </p>
                <h1 className="mt-2 font-serif text-[2.4rem] tracking-[-0.02em] leading-none">{boss ? 'Boss Round' : `Level ${session.current_turn}`}</h1>
              </div>
              <div className="relative flex flex-wrap gap-2 text-[13px] font-medium" aria-live="polite">
                <span className={`num rounded-full px-3 py-1.5 font-mono ${boss ? 'bg-paper/10' : 'bg-sunken'}`}>XP {game.total_xp}</span>
                <span className={`num rounded-full px-3 py-1.5 font-mono ${boss ? 'bg-paper/10' : 'bg-sunken'}`}>Streak {game.current_streak}</span>
                <span className={`rounded-full px-3 py-1.5 ${boss ? 'bg-paper text-ink' : 'bg-ink text-paper'}`}>{difficultyLabel(question.difficulty)}</span>
                {coding && <span className={`flex items-center gap-1 rounded-full border px-3 py-1.5 ${boss ? 'border-paper/30' : 'border-line-strong'}`}><Code2 className="h-3.5 w-3.5" /> Coding</span>}
                {question.is_follow_up && <span className={`rounded-full border px-3 py-1.5 ${boss ? 'border-paper/30' : 'border-line-strong'}`}>AI Follow-up</span>}
                {result && game.xp_earned > 0 && (
                  <span aria-hidden="true" className="float-up pointer-events-none absolute -top-6 left-2 font-mono text-sm font-semibold">+{game.xp_earned}</span>
                )}
              </div>
            </div>
            <div className="mt-6 flex gap-1.5" aria-hidden="true">
              {Array.from({ length: totalLevels }, (_, index) => {
                const level = index + 1;
                const done = level < session.current_turn || (level === session.current_turn && result);
                const current = level === session.current_turn && !result;
                return (
                  <span key={level} className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${boss ? 'bg-paper/15' : 'bg-line'}`}>
                    {(done || current) && (
                      <span className={`grow-x absolute inset-0 rounded-full ${boss ? 'bg-paper' : 'bg-ink'} ${current ? 'opacity-40' : ''}`} />
                    )}
                  </span>
                );
              })}
            </div>
          </header>

          {result ? (
            <Panel key="result" className="scale-in overflow-hidden" aria-labelledby="answer-result">
              <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_260px] sm:p-8">
                <div>
                  <h2 id="answer-result" className="text-[15px] font-semibold text-ink">Answer Result</h2>
                  <p className="mt-4 flex items-baseline gap-2">
                    <span className="num font-serif text-6xl leading-none text-ink"><CountUp value={result.evaluation.answer_quality_score} /></span>
                    <span className="text-ink-3">/ 100</span>
                  </p>
                  <p className="sr-only">Answer Score: {result.evaluation.answer_quality_score} / 100</p>
                  <h3 className="mt-6 text-[13px] text-ink-3">Feedback</h3>
                  <p className="mt-1.5 leading-relaxed text-ink-2">{result.evaluation.feedback || 'No evaluator feedback was available.'}</p>
                  {result.evaluation.evaluation_source === 'fallback' && <p className="mt-3 text-[13px] text-warn">Approximate evaluation: the AI evaluator was unavailable for this answer.</p>}
                  {result.ranking?.ratings?.overall && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-ink">
                      <ShieldCheck className="h-4 w-4" /> Rating {result.ranking.ratings.overall.rating}
                      {' '}({result.ranking.ratings.overall.change >= 0 ? '+' : ''}{result.ranking.ratings.overall.change}) · rank #{result.ranking.ratings.overall.rank}
                    </p>
                  )}
                </div>
                <dl className="self-start rounded-control border border-line bg-paper p-4 text-[13px]">
                  {[['Base Answer XP', game.base_xp], [`${difficultyLabel(question.difficulty)} Difficulty Bonus`, game.difficulty_bonus], ['Streak Bonus', game.streak_bonus], ['Hint Penalty', -game.hint_penalty]].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 py-1.5">
                      <dt className="text-ink-2">{label}</dt>
                      <dd className="num font-mono text-ink">{value >= 0 ? '+' : ''}{value}</dd>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between border-t border-line pt-3 text-sm font-semibold">
                    <dt>XP Earned</dt>
                    <dd className="num font-mono">{game.xp_earned} XP</dd>
                  </div>
                </dl>
              </div>
              <div className="flex justify-end border-t border-line bg-paper/60 px-6 py-4 sm:px-8">
                <button className="primary-btn" onClick={nextChallenge}>
                  {result.is_complete ? 'Finish Arena' : 'Next Challenge'} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </Panel>
          ) : coding ? (
            <Panel key={`coding-${question.index}`} className="p-5 sm:p-6">
              <CodingWorkspace
                interviewId={session.interview_id}
                question={question}
                submitting={busy}
                signals={signalsRef.current}
                onInjected={(chars) => guard.flagOnce('text_injected', { chars, source: 'editor' })}
                onSubmit={(codeAnswer) => submit(codeAnswer)}
              />
              {error && <Notice tone="warn" role="alert" className="mt-4">{error}</Notice>}
              {(phase === 'advance-error' || phase === 'submit-error') && (
                <button className="primary-btn mt-4" onClick={() => submit()}>{phase === 'advance-error' ? 'Retry Advancement' : 'Retry Submission'}</button>
              )}
            </Panel>
          ) : (
            <Panel key={`question-${question.index}`} className="p-6 sm:p-8">
              <p className="text-[13px] text-ink-3">{question.topic}</p>
              <h2 className="mt-2 font-serif text-[1.5rem] leading-snug text-ink">{question.question}</h2>
              <label htmlFor="arena-answer" className="field-label mt-7">Your answer</label>
              <textarea
                id="arena-answer" rows={7} value={answer} disabled={locked}
                onKeyDown={(event) => { signalsRef.current?.typing.keydown(event); signalsRef.current?.markActivity(); }}
                onChange={(event) => {
                  const value = event.target.value;
                  if (signalsRef.current?.typing.input(event.nativeEvent, value.length - answer.length)) {
                    guard.flagOnce('text_injected', { chars: value.length - answer.length });
                  }
                  setAnswer(value);
                }}
                className="input-field !text-[15px] leading-relaxed" placeholder="Explain your approach and reasoning…"
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="secondary-btn !py-2" onClick={requestHint} disabled={locked || game.remaining_hints === 0}>
                  <Lightbulb aria-hidden="true" className="h-4 w-4" /> Use Hint
                </button>
                <span className="text-[13px] text-ink-2">{game.remaining_hints} {game.remaining_hints === 1 ? 'Hint' : 'Hints'}</span>
                <span className="text-xs text-ink-3">One per session · −20 XP on this turn</span>
              </div>
              {hint && <Notice className="mt-4">{hint}</Notice>}
              {error && <Notice tone="warn" role="alert" className="mt-4">{error}</Notice>}
              {responseRef.current && <p className="mt-3 text-[13px] text-ink-3">Answer saved and locked.</p>}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                <p role="status" className="flex items-center gap-2 text-[13px] text-ink-2">
                  {(phase === 'advancing' || phase === 'hint') && <Spinner className="h-3.5 w-3.5" />}
                  {phase === 'advancing' ? 'Preparing your result and next challenge…' : phase === 'hint' ? 'Preparing your hint…' : ''}
                </p>
                <button className="primary-btn" onClick={() => submit()} disabled={busy || (!responseRef.current && !answer.trim())}>
                  {phase === 'submitting' ? 'Analyzing your answer…' : phase === 'advancing' ? 'Preparing your result…' : phase === 'advance-error' ? 'Retry Advancement' : phase === 'submit-error' ? 'Retry Submission' : 'Submit Answer'}
                </button>
              </div>
            </Panel>
          )}
        </div>

        {/* Camera and integrity status */}
        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Panel className="overflow-hidden">
            <div className="relative aspect-video bg-ink">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {!cameraReady && <div className="absolute inset-0 grid place-items-center text-paper/60"><Camera className="h-6 w-6" /></div>}
            </div>
          </Panel>
          <BehaviorMonitor
            videoRef={videoRef}
            active={cameraReady}
            segmentKey={question.index}
            sampleIntervalMs={100}
            onFrame={(observation, time) => guard.handleFrame(observation, time, {
              signals: signalsRef.current, listening: !result,
            })}
          />
          <Panel className="p-5 text-[13px]">
            <div className="flex items-center justify-between"><span className="text-ink-2">Identity</span><span>{guard.enrolled ? 'Verified at start' : 'Not checked'}</span></div>
            <div className="mt-2 flex items-center justify-between"><span className="text-ink-2">Integrity warnings</span><span className={guard.violations ? 'text-warn' : ''}>{guard.violations} of {guard.maxViolations}</span></div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
