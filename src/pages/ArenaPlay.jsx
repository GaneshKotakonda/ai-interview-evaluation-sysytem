import { useEffect, useRef, useState } from 'react';
import { Gamepad2, Loader2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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

  if (!valid) return <section className="card mx-auto max-w-xl p-8">
    <h1 className="text-2xl font-bold">Interview Arena</h1>
    <p className="my-4 text-slate-600">Choose a practice area to start your challenge.</p>
    <Link to="/arena" className="primary-btn">Choose Practice Area</Link>
  </section>;
  if (!question) return <section className="card mx-auto max-w-xl p-8">
    <h1 className="text-2xl font-bold">Preparing Interview Arena</h1>
    {phase === 'loading' ? <p role="status" className="mt-4 flex gap-2"><Loader2 className="h-5 w-5 animate-spin" />Preparing your first challenge…</p>
      : <><p role="alert" className="my-4">{error}</p><button className="primary-btn" onClick={() => setAttempt((n) => n + 1)}>Retry Start</button></>}
  </section>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className={`rounded-2xl p-6 text-white shadow-card sm:p-8 ${question.boss_round ? 'bg-indigo-950' : 'bg-navy-900'}`}>
        <p className="flex items-center gap-2 text-sm font-semibold text-teal-200"><Gamepad2 aria-hidden="true" className="h-5 w-5" />Interview Arena</p>
        <h1 className="mt-3 text-3xl font-bold">{question.boss_round ? 'Boss Round' : `Level ${session.current_turn}`}</h1>
        <p className="mt-2 text-sm text-slate-300">Challenge {session.current_turn} of {session.max_turns} · {session.role_title || config.role_title}</p>
        <div className="mt-5 flex flex-wrap gap-3 font-semibold" aria-live="polite">
          <span className="rounded-xl bg-white/10 px-4 py-2">XP {game.total_xp}</span>
          <span className="rounded-xl bg-white/10 px-4 py-2">Streak {game.current_streak}</span>
          <span className="rounded-xl bg-white/10 px-4 py-2">{difficultyLabel(question.difficulty)}</span>
          {question.is_follow_up && <span className="rounded-xl bg-teal-800 px-4 py-2">AI Follow-up</span>}
        </div>
      </header>
      {result ? <section className="card p-6 sm:p-8" aria-labelledby="answer-result">
        <h2 id="answer-result" className="text-2xl font-bold text-slate-900">Answer Result</h2>
        <p className="mt-3 text-lg font-semibold">Answer Score: {result.evaluation.answer_quality_score} / 100</p>
        <dl className="my-6 space-y-3 rounded-xl bg-slate-50 p-5 text-sm">
          {[['Base Answer XP', game.base_xp], [`${difficultyLabel(question.difficulty)} Difficulty Bonus`, game.difficulty_bonus], ['Streak Bonus', game.streak_bonus], ['Hint Penalty', -game.hint_penalty]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd>{value >= 0 ? '+' : ''}{value}</dd></div>)}
          <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><dt>XP Earned</dt><dd>{game.xp_earned} XP</dd></div>
        </dl>
        <h3 className="font-semibold">Feedback</h3>
        <p className="mt-2 leading-7 text-slate-600">{result.evaluation.feedback || 'No evaluator feedback was available.'}</p>
        {result.evaluation.evaluation_source === 'fallback' && <p className="mt-3 text-sm text-amber-700">Approximate evaluation: the AI evaluator was unavailable for this answer.</p>}
        <button className="primary-btn mt-6" onClick={nextChallenge}>{result.is_complete ? 'Finish Arena' : 'Next Challenge'}</button>
      </section> : <section className="card p-6 sm:p-8">
        <p className="text-sm font-semibold text-tealish-700">{question.topic}</p>
        <h2 className="mt-2 text-xl font-bold leading-8 text-slate-900">{question.question}</h2>
        <label htmlFor="arena-answer" className="mt-6 block text-sm font-semibold text-slate-700">Your answer</label>
        <textarea id="arena-answer" rows={7} value={answer} disabled={locked} onChange={(event) => setAnswer(event.target.value)} className="input-field mt-2" placeholder="Explain your approach and reasoning…" />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="secondary-btn" onClick={requestHint} disabled={locked || game.remaining_hints === 0}>Use Hint</button>
          <span className="text-sm text-slate-500">{game.remaining_hints} {game.remaining_hints === 1 ? 'Hint' : 'Hints'}</span>
          <span className="text-xs text-slate-500">One hint per session · −20 XP on this turn</span>
        </div>
        {hint && <p className="mt-4 rounded-xl bg-tealish-50 p-4 text-sm text-slate-700">{hint}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{error}</p>}
        {responseRef.current && <p className="mt-3 text-sm text-slate-500">Answer saved and locked.</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-slate-500">{phase === 'advancing' ? 'Preparing your result and next challenge…' : phase === 'hint' ? 'Preparing your hint…' : ''}</p>
          <button className="primary-btn" onClick={submit} disabled={busy || (!responseRef.current && !answer.trim())}>
            {phase === 'submitting' ? 'Analyzing your answer…' : phase === 'advancing' ? 'Preparing your result…' : phase === 'advance-error' ? 'Retry Advancement' : phase === 'submit-error' ? 'Retry Submission' : 'Submit Answer'}
          </button>
        </div>
      </section>}
    </div>
  );
}
