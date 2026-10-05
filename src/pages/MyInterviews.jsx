import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ListChecks,
  Search,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Badge, EmptyState, Notice, PageHeader, Panel, ScoreBar, Segmented, Skeleton, Spinner,
} from '../components/ui';
import { api } from '../services/api';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { formatDate, formatDuration, isCompleted, modeLabel, resultLink } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Filter definitions
// -------------------------------------------------------------
const MODE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'standard', label: 'Standard' },
  { value: 'game', label: 'Arena' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'incomplete', label: 'Incomplete' },
];

const SORTS = {
  newest: { label: 'Newest first', compare: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  oldest: { label: 'Oldest first', compare: (a, b) => new Date(a.created_at) - new Date(b.created_at) },
  score: {
    label: 'Highest score',
    compare: (a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1),
  },
};

function StatusBadge({ interview }) {
  if (interview.ended_early) return <Badge tone="bad">Ended early</Badge>;
  return isCompleted(interview)
    ? <Badge tone="ok">Completed</Badge>
    : <Badge tone="warn">Incomplete</Badge>;
}

// Confirmation dialog for deleting one interview. Escape cancels.
function DeleteDialog({ interview, deleting, error, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !deleting) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleting, onCancel]);

  return (
    <div className="fade-in fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="scale-in w-full max-w-md rounded-panel border border-line bg-surface p-6 shadow-pop">
        <h2 id="delete-title" className="font-serif text-2xl text-ink">Delete this interview?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          <span className="font-medium text-ink">{interview.role_title}</span> ({modeLabel(interview.interview_mode)}, {formatDate(interview.created_at)})
          and its answers, recordings and report will be permanently removed.
        </p>
        {error && <Notice tone="bad" className="mt-4">{error}</Notice>}
        <div className="mt-6 flex justify-end gap-2">
          <button className="secondary-btn" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="danger-btn" onClick={onConfirm} disabled={deleting}>
            {deleting ? <Spinner /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// BLOCK 2: Page — full interview history with filters and delete
// -------------------------------------------------------------
// Unlike the Dashboard (latest five completed), this lists every session,
// including ones that were abandoned before completion.
export default function MyInterviews() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    if (!user?.uid) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    api.getUserInterviews(user.uid)
      .then((history) => { if (active) setInterviews(Array.isArray(history) ? history : []); })
      .catch(() => { if (active) setError('We could not load your interviews. Please try again shortly.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.uid]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return interviews
      .filter((item) => mode === 'all' || (item.interview_mode || 'standard') === mode)
      .filter((item) => status === 'all' || (status === 'completed') === isCompleted(item))
      .filter((item) => !needle || (item.role_title || '').toLowerCase().includes(needle))
      .sort(SORTS[sort].compare);
  }, [interviews, query, mode, status, sort]);

  const completedCount = interviews.filter(isCompleted).length;

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionError('');
    try {
      await api.deleteInterview(pendingDelete.id);
      setInterviews((items) => items.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      setActionError('Could not delete this interview. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const startNewInterview = () => {
    clearInterviewProgress();
    navigate('/readiness');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        kicker="History"
        title="My Interviews"
        description={loading || error
          ? 'Every Standard interview and Arena session you have started.'
          : `${interviews.length} sessions · ${completedCount} completed`}
        actions={<button onClick={startNewInterview} className="primary-btn">New Interview <ArrowRight className="h-4 w-4" /></button>}
      />

      {error && <Notice tone="bad">{error}</Notice>}

      <Panel i={1} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search by role</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <input
              type="search"
              className="input-field !py-2 pl-9"
              placeholder="Search by role"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Filter by mode" options={MODE_FILTERS} value={mode} onChange={setMode} />
            <Segmented label="Filter by status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
            <select aria-label="Sort interviews" className="input-field !w-auto !py-2" value={sort} onChange={(event) => setSort(event.target.value)}>
              {Object.entries(SORTS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-11 w-full" />)}
          </div>
        ) : error ? null : interviews.length === 0 ? (
          <EmptyState icon={ListChecks} title="No interviews yet">Start your first interview and it will appear here.</EmptyState>
        ) : visible.length === 0 ? (
          <p className="fade-in px-6 py-14 text-center text-sm text-ink-3">No interviews match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-6 py-3 font-medium">Interview</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((item, index) => (
                  <tr key={item.id} className="reveal group transition hover:bg-paper" style={{ '--i': Math.min(index, 8) }}>
                    <td className="px-6 py-3.5 text-sm font-medium text-ink">
                      {item.role_title}
                      <span className="ml-2 text-xs font-normal text-ink-3">{modeLabel(item.interview_mode)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-[13px] text-ink-2">{formatDate(item.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="num px-4 py-3.5 font-mono text-[13px] text-ink-2">{formatDuration(item.duration_seconds)}</td>
                    <td className="px-4 py-3.5">
                      {item.overall_score === null || item.overall_score === undefined ? (
                        <span className="text-sm text-ink-4">—</span>
                      ) : (
                        <span className="flex items-center gap-2.5">
                          <span className="num w-9 font-mono text-[13px] text-ink">{item.overall_score}%</span>
                          <ScoreBar value={item.overall_score} className="w-14" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5"><StatusBadge interview={item} /></td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {isCompleted(item) && (
                          <Link to={resultLink(item)} aria-label={`View result for ${item.role_title}`} className="ghost-btn !py-1.5 text-[13px]">
                            View
                          </Link>
                        )}
                        <button
                          onClick={() => { setActionError(''); setPendingDelete(item); }}
                          aria-label={`Delete ${item.role_title} interview`}
                          className="rounded-md p-2 text-ink-4 opacity-60 transition hover:bg-bad-soft hover:text-bad group-hover:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {pendingDelete && (
        <DeleteDialog
          interview={pendingDelete}
          deleting={deleting}
          error={actionError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
