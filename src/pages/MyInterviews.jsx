import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ListChecks,
  LoaderCircle,
  Search,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { formatDate, formatDuration, isCompleted, modeLabel, resultLink } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Filter definitions
// -------------------------------------------------------------
const MODE_FILTERS = [
  { value: 'all', label: 'All modes' },
  { value: 'standard', label: 'Standard' },
  { value: 'game', label: 'Arena' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
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
  return isCompleted(interview) ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Completed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
      <Clock3 className="h-3.5 w-3.5" /> Incomplete
    </span>
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
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">History</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">My Interviews</h1>
          <p className="mt-2 text-slate-500">
            {loading || error
              ? 'Every Standard interview and Arena session you have started.'
              : `${interviews.length} sessions · ${completedCount} completed`}
          </p>
        </div>
        <button onClick={startNewInterview} className="primary-btn self-start sm:self-auto">
          New Interview <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
          <label className="relative">
            <span className="sr-only">Search by role</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input-field pl-9"
              placeholder="Search by role"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select aria-label="Filter by mode" className="input-field" value={mode} onChange={(event) => setMode(event.target.value)}>
            {MODE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select aria-label="Filter by status" className="input-field" value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select aria-label="Sort interviews" className="input-field" value={sort} onChange={(event) => setSort(event.target.value)}>
            {Object.entries(SORTS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 px-6 py-12 text-sm text-slate-500">
            <LoaderCircle className="h-5 w-5 animate-spin text-tealish-600" />
            Loading interviews...
          </div>
        ) : error ? null : interviews.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy-700">
              <ListChecks className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-slate-900">No interviews yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Start your first interview and it will appear here.</p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-500">No interviews match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-semibold">Interview</th>
                  <th className="px-6 py-3 font-semibold">Started</th>
                  <th className="px-6 py-3 font-semibold">Duration</th>
                  <th className="px-6 py-3 font-semibold">Score</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                      {item.role_title}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{modeLabel(item.interview_mode)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{formatDate(item.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{formatDuration(item.duration_seconds)}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-navy-800">
                      {item.overall_score === null || item.overall_score === undefined ? <span className="font-normal text-slate-400">—</span> : `${item.overall_score}%`}
                    </td>
                    <td className="px-6 py-4"><StatusBadge interview={item} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-4">
                        {isCompleted(item) && (
                          <Link to={resultLink(item)} aria-label={`View result for ${item.role_title}`} className="text-sm font-semibold text-navy-700 hover:text-navy-900">
                            View
                          </Link>
                        )}
                        <button
                          onClick={() => { setActionError(''); setPendingDelete(item); }}
                          aria-label={`Delete ${item.role_title} interview`}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
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
      </section>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="card w-full max-w-md p-6">
            <h2 id="delete-title" className="text-lg font-bold text-slate-900">Delete this interview?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              <span className="font-semibold">{pendingDelete.role_title}</span> ({modeLabel(pendingDelete.interview_mode)}, {formatDate(pendingDelete.created_at)})
              and its answers, recordings and report will be permanently removed.
            </p>
            {actionError && <p role="alert" className="mt-3 text-sm text-rose-700">{actionError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button className="secondary-btn" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</button>
              <button
                className="primary-btn bg-rose-600 hover:bg-rose-700"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
