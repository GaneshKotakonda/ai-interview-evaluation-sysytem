import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import {
  Badge, LoadingBlock, Notice, PageHeader, Panel, SectionTitle, Stat, StatRow,
} from '../components/ui';
import { api } from '../services/api';

// -------------------------------------------------------------
// Usage overview (owner only)
// -------------------------------------------------------------
// The server returns data only to the one owner account set in its private
// .env; for anyone else the overview does not exist (404) and this page
// sends them to the dashboard, like any unknown address. "Active" means the
// person started an interview or Arena game in that window.
const when = (value) => (value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function ago(value) {
  if (!value) return 'Never';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const MODE = { standard: 'Interview', game: 'Arena' };
const STATUS_TONE = { completed: 'ok', in_progress: 'warn' };

export default function Admin() {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error | hidden
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api.getAdminOverview());
      setState('ready');
    } catch (error) {
      setState(error?.status === 404 || error?.status === 403 ? 'hidden' : 'error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state === 'hidden') return <Navigate to="/dashboard" replace />;
  if (state === 'loading') return <LoadingBlock label="Loading usage…" />;

  const s = data?.summary || {};
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Owner only"
        title="Usage"
        description="Sign-ups, active users and sessions. Active means someone started an interview or Arena game in that time; the app does not track who is online."
        actions={(
          <button className="secondary-btn" onClick={load} disabled={refreshing}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        )}
      />
      {state === 'error' && <Notice tone="bad" role="alert">The overview could not be loaded. Check that the server is running, then refresh.</Notice>}

      {data && (
        <>
          <StatRow i={1}>
            <Stat label="Registered users" value={s.total_users} hint={`${s.new_users_7d} new this week`} />
            <Stat label="Active today" value={s.active_24h} hint="Last 24 hours" />
            <Stat label="Active this week" value={s.active_7d} hint={`${s.active_30d} in 30 days`} />
            <Stat label="In progress now" value={s.in_progress_now} hint="Started in the last 2 hours" />
          </StatRow>
          <StatRow i={2}>
            <Stat label="Sessions" value={s.sessions} />
            <Stat label="Interviews" value={s.standard_sessions} />
            <Stat label="Arena games" value={s.arena_sessions} />
            <Stat label="Completed" value={s.completed_sessions} />
          </StatRow>

          <Panel i={3} className="overflow-hidden">
            <div className="border-b border-line px-6 py-5">
              <SectionTitle title="Users" description="Everyone who has signed up, most recently active first." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-3 py-3 font-medium">Joined</th>
                    <th className="px-3 py-3 text-right font-medium">Sessions</th>
                    <th className="px-3 py-3 text-right font-medium">Completed</th>
                    <th className="px-3 py-3 text-right font-medium">Arena</th>
                    <th className="px-3 py-3 text-right font-medium">Avg. score</th>
                    <th className="px-6 py-3 font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.users.map((u) => (
                    <tr key={`${u.email}-${u.created_at}`}>
                      <td className="px-6 py-3">
                        <p className="font-medium text-ink">{u.full_name || '—'}</p>
                        <p className="text-xs text-ink-3">{u.email || '—'}</p>
                      </td>
                      <td className="px-3 py-3 text-ink-2">{when(u.created_at)}</td>
                      <td className="num px-3 py-3 text-right font-mono">{u.sessions}</td>
                      <td className="num px-3 py-3 text-right font-mono">{u.completed}</td>
                      <td className="num px-3 py-3 text-right font-mono">{u.arena_sessions}</td>
                      <td className="num px-3 py-3 text-right font-mono">{u.average_score ?? '—'}</td>
                      <td className="px-6 py-3 text-ink-2">{ago(u.last_active)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel i={4} className="overflow-hidden">
            <div className="border-b border-line px-6 py-5">
              <SectionTitle title="Recent sessions" description="The latest 50 interviews and Arena games." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-3 py-3 font-medium">Type</th>
                    <th className="px-3 py-3 font-medium">Role</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 text-right font-medium">Score</th>
                    <th className="px-6 py-3 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.sessions.map((item, index) => (
                    <tr key={index}>
                      <td className="px-6 py-3">
                        <p className="font-medium text-ink">{item.full_name || '—'}</p>
                        <p className="text-xs text-ink-3">{item.email || '—'}</p>
                      </td>
                      <td className="px-3 py-3">{MODE[item.interview_mode] || item.interview_mode}</td>
                      <td className="px-3 py-3 text-ink-2">{item.role_title}</td>
                      <td className="px-3 py-3"><Badge tone={STATUS_TONE[item.status] || 'neutral'}>{item.status.replace('_', ' ')}</Badge></td>
                      <td className="num px-3 py-3 text-right font-mono">{item.overall_score ?? '—'}</td>
                      <td className="px-6 py-3 text-ink-2">{when(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
