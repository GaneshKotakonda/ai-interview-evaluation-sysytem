import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Gamepad2, Lightbulb } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  CountUp, EmptyState, Notice, Panel, Spinner,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { STORAGE_KEYS } from '../utils/interviewJourney';

// -------------------------------------------------------------
// Arena game screen
// -------------------------------------------------------------
// Flow per level: answer → submit (graded once, retry-safe) → advance (XP,
// streak, next question) → result card → "Next Challenge". The config comes
// from the Arena setup page through router state; without it the user is
// sent back to choose a practice area. Text answers only, no camera.
const difficultyLabel = (value) => value ? value[0].toUpperCase() + value.slice(1) : '';

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
  const startRef = useRef(null);
  const responseRef = useRef(null);
  const submittedPayloadRef = useRef(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const busy = ['loading', 'submitting', 'advancing', 'hint'].includes(phase);
  const locked = busy || Boolean(submittedPayloadRef.current);

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
      startRef.current = api.startInterview(config.role_title, user?.uid || null,
        config.job_description || `Practice ${config.topic} interview questions.`,
        user?.email || null, user?.displayName || null, 6, 'game');
    }
    startRef.current.then((data) => {
      if (!active) return;
      if (data.interview_mode !== 'game' || !data.question) throw new Error('Invalid Arena session');
      sessionStorage.setItem(STORAGE_KEYS.arenaInterviewId, data.interview_id);
      setSession(data);
      setQuestion(data.question);
      setPhase('answering');
    }).catch(() => {
      if (!active) return;
      startRef.current = null;
      setError('Unable to start Arena. Check your connection and retry.');
      setPhase('start-error');
    });
    return () => { active = false; };
  }, [valid, attempt]);

  // Submit the answer (if not yet accepted), then advance to get the result.
  async function submit() {
    if (busyRef.current || result || (!responseRef.current && !answer.trim())) return;
    busyRef.current = true;
    setError('');
    try {
      if (!responseRef.current) {
        setPhase('submitting');
        // A network failure may hide a committed answer. Always replay the same
        // payload so the backend can return its original response ID.
        submittedPayloadRef.current ||= {
          questionIndex: question.index, questionText: question.question,
          candidateAnswer: answer, videoBlob: null,
        };
        const saved = await api.submitAnswer(session.interview_id, submittedPayloadRef.current);
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
    } catch {
      if (!mountedRef.current) return;
      setPhase(responseRef.current ? 'advance-error' : 'submit-error');
      setError(responseRef.current
        ? 'Your answer is saved. Retry advancement to retrieve your result; the answer will not be submitted again.'
        : 'Submission could not be confirmed. Your answer is locked and preserved; retry will send the same text safely.');
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
      navigate('/arena/results');
      return;
    }
    setSession((previous) => ({ ...previous, current_turn: result.current_turn, max_turns: result.max_turns }));
    setQuestion(result.next_question);
    setAnswer('');
    setHint('');
    responseRef.current = null;
    submittedPayloadRef.current = null;
    setResult(null);
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

  const boss = Boolean(question.boss_round);
  const totalLevels = session.max_turns || 6;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
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
            <h1 className="mt-2 font-serif text-[2.8rem] leading-none">{boss ? 'Boss Round' : `Level ${session.current_turn}`}</h1>
          </div>
          <div className="relative flex flex-wrap gap-2 text-[13px] font-medium" aria-live="polite">
            <span className={`num rounded-full px-3 py-1.5 font-mono ${boss ? 'bg-paper/10' : 'bg-sunken'}`}>XP {game.total_xp}</span>
            <span className={`num rounded-full px-3 py-1.5 font-mono ${boss ? 'bg-paper/10' : 'bg-sunken'}`}>Streak {game.current_streak}</span>
            <span className={`rounded-full px-3 py-1.5 ${boss ? 'bg-paper text-ink' : 'bg-ink text-paper'}`}>{difficultyLabel(question.difficulty)}</span>
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
                <span className="num font-serif text-7xl leading-none text-ink"><CountUp value={result.evaluation.answer_quality_score} /></span>
                <span className="text-ink-3">/ 100</span>
              </p>
              <p className="sr-only">Answer Score: {result.evaluation.answer_quality_score} / 100</p>
              <h3 className="mt-6 text-[13px] text-ink-3">Feedback</h3>
              <p className="mt-1.5 leading-relaxed text-ink-2">{result.evaluation.feedback || 'No evaluator feedback was available.'}</p>
              {result.evaluation.evaluation_source === 'fallback' && <p className="mt-3 text-[13px] text-warn">Approximate evaluation: the AI evaluator was unavailable for this answer.</p>}
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
      ) : (
        <Panel key={`question-${question.index}`} className="p-6 sm:p-8">
          <p className="text-[13px] text-ink-3">{question.topic}</p>
          <h2 className="mt-2 font-serif text-[1.75rem] leading-snug text-ink">{question.question}</h2>
          <label htmlFor="arena-answer" className="field-label mt-7">Your answer</label>
          <textarea id="arena-answer" rows={7} value={answer} disabled={locked} onChange={(event) => setAnswer(event.target.value)} className="input-field !text-[15px] leading-relaxed" placeholder="Explain your approach and reasoning…" />
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
            <button className="primary-btn" onClick={submit} disabled={busy || (!responseRef.current && !answer.trim())}>
              {phase === 'submitting' ? 'Analyzing your answer…' : phase === 'advancing' ? 'Preparing your result…' : phase === 'advance-error' ? 'Retry Advancement' : phase === 'submit-error' ? 'Retry Submission' : 'Submit Answer'}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
