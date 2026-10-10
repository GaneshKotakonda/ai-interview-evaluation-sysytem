import { useEffect, useState } from 'react';
import { ArrowLeft, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  EmptyState, Notice, PageHeader, Panel, Spinner,
} from '../components/ui';
import { api } from '../services/api';

// -------------------------------------------------------------
// Arena leaderboard: overall and per-category ranking (LeetCode-style
// ratings). Names are profile names; emails are never shown.
// -------------------------------------------------------------
export default function Leaderboard() {
  const [category, setCategory] = useState('overall');
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    api.getLeaderboard(category)
      .then((data) => { if (active) setBoard(data); })
      .catch(() => { if (active) setError('The leaderboard could not be loaded. Please try again.'); });
    return () => { active = false; };
  }, [category]);

  const categories = board?.categories || [{ id: 'overall', label: 'Overall' }];
  const me = board?.me;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        kicker="Interview Arena"
        title="Leaderboard"
        description="Ratings start at 1500. Strong sessions at harder levels raise them; weak sessions and integrity warnings lower them."
        actions={<Link to="/arena" className="secondary-btn"><ArrowLeft className="h-4 w-4" /> Back to Arena</Link>}
      />

      <div role="tablist" aria-label="Ranking category" className="flex flex-wrap gap-2">
        {categories.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={category === item.id}
            onClick={() => setCategory(item.id)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] transition ${category === item.id ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink-2 hover:border-ink-4'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {me?.rank && (
        <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="text-sm text-ink-2">Your position</p>
          <p className="flex items-baseline gap-3">
            <span className="num font-serif text-4xl leading-none text-ink">#{me.rank}</span>
            <span className="text-[13px] text-ink-3">of {me.total} · rating {me.rating}</span>
          </p>
        </Panel>
      )}

      {error && <Notice tone="warn" role="alert">{error}</Notice>}
      {!board && !error && <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Loading the leaderboard…</p>}
      {board && !board.rows.length && (
        <Panel>
          <EmptyState icon={Trophy} title="No ranked players yet" action={<Link to="/arena" className="primary-btn">Play ranked Arena</Link>}>
            Finish a ranked Arena in this category to appear here.
          </EmptyState>
        </Panel>
      )}
      {board?.rows.length > 0 && (
        <Panel className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-3">
              <tr>
                <th className="px-5 py-3 font-medium">Rank</th>
                <th className="px-5 py-3 font-medium">Student</th>
                <th className="px-5 py-3 text-right font-medium">Rating</th>
                <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">Best</th>
                <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">Sessions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {board.rows.map((row) => (
                <tr key={`${row.rank}-${row.name}-${row.rating}`} className={row.is_me ? 'bg-sunken' : ''}>
                  <td className="num px-5 py-3 font-mono text-ink">{row.rank <= 3 ? <Trophy className="inline h-3.5 w-3.5 text-ink-2" /> : null} {row.rank}</td>
                  <td className="px-5 py-3 text-ink">{row.name}{row.is_me && <span className="ml-2 text-xs text-ink-3">(you)</span>}</td>
                  <td className="num px-5 py-3 text-right font-mono text-ink">{row.rating}</td>
                  <td className="num hidden px-5 py-3 text-right font-mono text-ink-3 sm:table-cell">{row.best_rating}</td>
                  <td className="num hidden px-5 py-3 text-right font-mono text-ink-3 sm:table-cell">{row.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
