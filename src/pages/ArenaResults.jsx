import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Trophy } from 'lucide-react';
import {
  CountUp, EmptyState, Notice, PageHeader, Panel, ScoreBar, SectionTitle, Spinner, Stat, StatRow,
} from '../components/ui';
import { api } from '../services/api';
import { STORAGE_KEYS } from '../utils/interviewJourney';

// -------------------------------------------------------------
// Arena results page
// -------------------------------------------------------------
// Loads the saved summary for ?id=<uuid> (Dashboard links) or, right after
// a game, for the id ArenaPlay stored in sessionStorage. Everything shown
// comes from the server; nothing is computed or invented here.
export default function ArenaResults() {
  const [searchParams] = useSearchParams();
  const interviewId = searchParams.get('id') || sessionStorage.getItem(STORAGE_KEYS.arenaInterviewId);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Fetch (and re-fetch on "Retry Results") the saved summary.
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

  if (!interviewId) return (
    <Panel className="mx-auto max-w-xl">
      <EmptyState icon={Trophy} title="Arena Results" headingLevel="h1" action={<Link to="/arena" className="primary-btn">Choose Practice Area</Link>}>
        No Arena session is selected.
      </EmptyState>
    </Panel>
  );
  if (!results) return (
    <Panel className="mx-auto max-w-xl p-8">
      <h1 className="font-serif text-3xl text-ink">Arena Results</h1>
      {error ? (
        <>
          <Notice tone="bad" className="my-4">{error}</Notice>
          <button className="primary-btn" onClick={() => setAttempt((n) => n + 1)}>Retry Results</button>
        </>
      ) : (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-2"><Spinner /> Loading your saved results…</p>
      )}
    </Panel>
  );

  // The last turn of a full Arena session is the Boss Round.
  const bossTurn = results.max_turns || 6;
  const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '—');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        kicker={results.role_title ? `${results.role_title} · Interview Arena` : 'Interview Arena'}
        title="Arena Complete"
        description="Your saved challenge results, level by level."
      />

      <Panel i={1} className="grid overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col justify-between gap-8 bg-ink p-7 text-paper">
          <Trophy aria-hidden="true" className="h-6 w-6 text-paper/60" />
          <div>
            <p className="num font-serif text-[4.25rem] tracking-[-0.03em] leading-[0.85]"><CountUp value={results.total_xp} duration={1200} /></p>
            <p className="mt-3 text-[13px] text-paper/60">Total XP</p>
          </div>
        </div>
        {/* gap-px over a line-coloured background draws the hairlines */}
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
          {[
            ['Best Streak', results.best_streak],
            ['Average Answer Score', `${results.average_score} / 100`],
            ['Highest Difficulty', capitalize(results.highest_difficulty)],
            ['Boss Round Score', results.boss_score == null ? 'Unavailable' : `${results.boss_score} / 100`],
            ['Questions Completed', results.questions_completed],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface"><Stat label={label} value={value} /></div>
          ))}
          <div className="bg-surface" aria-hidden="true" />
        </div>
      </Panel>

      {results.ended_early && (
        <Notice tone="bad">
          {results.end_reason === 'away'
            ? 'This Arena ended because you stayed outside it too long. Unplayed levels scored 0 and a penalty was applied to your rating.'
            : 'This Arena ended after repeated integrity warnings. Unplayed levels scored 0 and a penalty was applied to your rating.'}
        </Notice>
      )}
      {results.integrity?.verdict === 'invalid' && (
        <Notice tone="bad">The candidate's identity could not be confirmed, so this session scored 0.</Notice>
      )}

      {results.ratings && (
        <Panel i={2} className="p-6 sm:p-7">
          <SectionTitle
            title="Rating"
            description="LeetCode-style rating: your score compared with the difficulty you reached, minus integrity penalties."
            action={<Link to="/arena/leaderboard" className="text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">Leaderboard</Link>}
          />
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {Object.entries(results.ratings).sort(([a]) => (a === 'overall' ? -1 : 1)).map(([key, item]) => (
              <li key={key} className="rounded-control border border-line p-4">
                <p className="text-[13px] text-ink-3">{item.label}</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="num font-serif text-4xl leading-none text-ink">{item.rating}</span>
                  <span className={`num font-mono text-sm ${item.change >= 0 ? 'text-ok' : 'text-bad'}`}>{item.change >= 0 ? '+' : ''}{item.change}</span>
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  Rank #{item.rank} of {item.total}{item.penalty ? ` · includes −${item.penalty} integrity penalty` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="grid gap-5 sm:grid-cols-2">
        {[['Strongest Areas', results.strongest_areas], ['Areas to Practice', results.practice_areas]].map(([title, topics], index) => (
          <Panel key={title} i={index + 2} as="article" className="p-6">
            <SectionTitle title={title} description="Average evaluated score for each topic." />
            {topics.length ? (
              <ul className="mt-4 divide-y divide-line">
                {topics.map((item) => (
                  <li key={item.topic} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="text-ink">{item.topic}</span>
                    <span className="flex items-center gap-3">
                      <ScoreBar value={item.score} className="w-16" />
                      <span className="num whitespace-nowrap text-right font-mono text-[13px] text-ink-2">{item.score} / 100</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-ink-3">Not enough data yet.</p>}
          </Panel>
        ))}
      </section>

      <Panel i={4} className="p-6 sm:p-8">
        <SectionTitle title="Challenge Feedback" />
        <ol className="mt-5 divide-y divide-line">
          {results.turns.map((turn, index) => (
            <li key={turn.question_index} className="reveal grid gap-1 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6" style={{ '--i': index + 5 }}>
              <h3 className="text-sm font-medium text-ink">
                {turn.question_index === bossTurn ? 'Boss Round' : `Level ${turn.question_index}`} · {turn.topic}
              </h3>
              <div>
                <p className="text-sm leading-relaxed text-ink-2">{turn.feedback}</p>
                {turn.evaluation_source === 'fallback' && <p className="mt-1.5 text-xs text-warn">Approximate evaluation — AI evaluator unavailable.</p>}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <nav aria-label="Arena result actions" className="reveal flex flex-wrap gap-2" style={{ '--i': 6 }}>
        <Link to="/arena" className="primary-btn">Play Again <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        <Link to="/readiness" className="secondary-btn">Try Standard Interview</Link>
        <Link to="/dashboard" className="ghost-btn">Back to Dashboard</Link>
      </nav>
    </div>
  );
}
