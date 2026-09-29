import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { api } from '../services/api';

export default function ArenaResults() {
  const interviewId = sessionStorage.getItem('arena-interview-id');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!interviewId) return;
    let active = true;
    setError('');
    api.getArenaResults(interviewId).then((data) => {
      if (data.interview_mode !== 'game') throw new Error('Wrong interview mode');
      if (active) setResults(data);
    }).catch(() => {
      if (active) setError('Unable to load your saved Arena results. Please retry.');
    });
    return () => { active = false; };
  }, [interviewId, attempt]);

  if (!interviewId) return <section className="card mx-auto max-w-xl p-8">
    <h1 className="text-2xl font-bold">Arena Results</h1><p className="my-4">No Arena session is selected.</p><Link to="/arena" className="primary-btn">Choose Practice Area</Link>
  </section>;
  if (!results) return <section className="card mx-auto max-w-xl p-8">
    <h1 className="text-2xl font-bold">Arena Results</h1>
    {error ? <><p role="alert" className="my-4">{error}</p><button className="primary-btn" onClick={() => setAttempt((n) => n + 1)}>Retry Results</button></> : <p role="status" className="mt-4">Loading your saved results…</p>}
  </section>;

  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="rounded-2xl bg-navy-900 p-8 text-white">
      <Trophy aria-hidden="true" className="h-8 w-8 text-teal-200" />
      <h1 className="mt-4 text-3xl font-bold">Arena Complete</h1>
      <p className="mt-2 text-slate-300">{results.role_title} · Your challenge results</p>
    </header>
    <section aria-label="Arena statistics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[
        ['Total XP', results.total_xp], ['Best Streak', results.best_streak],
        ['Average Answer Score', `${results.average_score} / 100`],
        ['Highest Difficulty Reached', results.highest_difficulty[0].toUpperCase() + results.highest_difficulty.slice(1)],
        ['Boss Round Score', results.boss_score == null ? 'Unavailable' : `${results.boss_score} / 100`],
        ['Questions Completed', results.questions_completed],
      ].map(([label, value]) => <div className="card p-5" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-navy-900">{value}</p></div>)}
    </section>
    <section className="grid gap-6 sm:grid-cols-2">
      {[["Strongest Areas", results.strongest_areas], ["Areas to Practice", results.practice_areas]].map(([title, topics]) => <article key={title} className="card p-6">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-2 text-xs text-slate-500">Based on your average evaluated score for each topic.</p>
        {topics.length ? <ul className="mt-4 space-y-3">{topics.map((item) => <li key={item.topic} className="flex justify-between gap-3 text-sm"><span>{item.topic}</span><span>{item.score} / 100</span></li>)}</ul> : <p className="mt-4 text-sm text-slate-500">Not enough data yet.</p>}
      </article>)}
    </section>
    <section className="card p-6">
      <h2 className="text-lg font-bold">Challenge Feedback</h2>
      <ol className="mt-4 space-y-4">{results.turns.map((turn) => <li key={turn.question_index} className="rounded-xl bg-slate-50 p-4">
        <h3 className="font-semibold">{turn.question_index === 6 ? 'Boss Round' : `Level ${turn.question_index}`} · {turn.topic}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{turn.feedback}</p>
        {turn.evaluation_source === 'fallback' && <p className="mt-2 text-xs text-amber-700">Approximate evaluation — AI evaluator unavailable.</p>}
      </li>)}</ol>
    </section>
    <nav aria-label="Arena result actions" className="flex flex-wrap gap-3">
      <Link to="/arena" className="primary-btn">Play Again</Link>
      <Link to="/readiness" className="secondary-btn">Try Standard Interview</Link>
      <Link to="/dashboard" className="secondary-btn">Back to Dashboard</Link>
    </nav>
  </div>;
}
