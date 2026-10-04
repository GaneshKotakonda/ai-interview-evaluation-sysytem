import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  CalendarDays,
  CheckCircle2,
  Gamepad2,
  Briefcase,
  Gauge,
  ListChecks,
  LoaderCircle,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import { api } from '../services/api';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { formatDate, formatDuration, isCompleted, resultLink } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
const statIcons = [ListChecks, Gauge, Award, CheckCircle2];

// -------------------------------------------------------------
// BLOCK 2: Page — stats, mode cards and recent history
// -------------------------------------------------------------
// Every number on this page is computed from the user's real saved
// interviews; nothing is substituted when the history cannot be loaded.
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const rawParts = (user?.displayName || 'Candidate').split(' ');
  const firstName = (rawParts[0].length === 1 && rawParts.length > 1) ? rawParts[1] : rawParts[0];
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');

  // Load the signed-in user's interview history once per user.
  useEffect(() => {
    let isMounted = true;

    async function loadInterviewHistory() {
      if (!user?.uid) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setHistoryError('');
        const history = await api.getUserInterviews(user.uid);
        if (isMounted) setInterviews(Array.isArray(history) ? history : []);
      } catch {
        if (isMounted) {
          setInterviews([]);
          setHistoryError('We could not load your interview history. Please try again shortly.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadInterviewHistory();

    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

  const completedInterviews = useMemo(
    () => interviews.filter(isCompleted),
    [interviews],
  );
  const scoredInterviews = useMemo(
    () => completedInterviews.filter(
      (item) => item.overall_score !== null && item.overall_score !== undefined,
    ),
    [completedInterviews],
  );

  const averageScore = scoredInterviews.length
    ? Math.round(
        scoredInterviews.reduce((total, item) => total + Number(item.overall_score), 0) /
          scoredInterviews.length,
      )
    : null;
  const bestScore = scoredInterviews.length
    ? Math.max(...scoredInterviews.map((item) => Number(item.overall_score)))
    : null;
  const completionRate = interviews.length
    ? Math.round((completedInterviews.length / interviews.length) * 100)
    : 0;

  const stats = [
    {
      label: 'Total Interviews',
      value: loading || historyError ? '—' : interviews.length,
      trend: 'All interview sessions',
    },
    {
      label: 'Average Score',
      value: loading || historyError || averageScore === null ? '—' : `${averageScore}%`,
      trend: 'Across scored interviews',
    },
    {
      label: 'Best Score',
      value: loading || historyError || bestScore === null ? '—' : `${bestScore}%`,
      trend: 'Highest completed score',
    },
    {
      label: 'Completed Interviews',
      value: loading || historyError ? '—' : completedInterviews.length,
      trend: 'Successfully evaluated',
    },
  ];

  const performanceOverview = [
    { label: 'Average Score', value: averageScore ?? 0 },
    { label: 'Best Score', value: bestScore ?? 0 },
    { label: 'Completion Rate', value: completionRate },
  ];

  const startNewInterview = () => {
    clearInterviewProgress();
    navigate('/readiness');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">Candidate Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Welcome back, {firstName}</h1>
          <p className="mt-2 text-slate-500">Ready to improve your next interview?</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <CalendarDays className="h-4 w-4 text-navy-700" />
          <span>Your interview history</span>
        </div>
      </section>

      {historyError && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{historyError}</p>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => <StatCard key={stat.label} {...stat} icon={statIcons[index]} />)}
      </section>

      <section aria-label="Choose your interview experience" className="grid gap-6 lg:grid-cols-2">
        <article className="card flex flex-col p-6 sm:p-8">
          <Briefcase aria-hidden="true" className="h-7 w-7 text-navy-700" />
          <h2 className="mt-4 text-2xl font-bold text-slate-900">Standard Interview</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Experience a realistic AI-driven interview with adaptive difficulty, intelligent follow-up questions, camera analysis and professional feedback.</p>
          <ul className="my-6 flex flex-wrap gap-2">
            {['Adaptive Questions', 'Dynamic Difficulty', 'AI Follow-ups', 'Professional Evaluation'].map((feature) => <li key={feature} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{feature}</li>)}
          </ul>
          <button onClick={startNewInterview} className="primary-btn mt-auto self-start">Start Standard Interview <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
        </article>
        <article className="flex flex-col rounded-2xl bg-navy-900 p-6 text-white shadow-card sm:p-8">
          <Gamepad2 aria-hidden="true" className="h-7 w-7 text-teal-200" />
          <h2 className="mt-4 text-2xl font-bold">Interview Arena</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">Practice your interview skills through adaptive challenges and a more interactive experience.</p>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-teal-200">Adaptive practice</p>
          <ul className="mb-6 mt-2 flex flex-wrap gap-2">
            {['Adaptive Challenges', 'XP & Levels', 'Streaks', 'Boss Round'].map((feature) => <li key={feature} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">{feature}</li>)}
          </ul>
          <button onClick={() => navigate('/arena')} className="secondary-btn mt-auto self-start">Enter Interview Arena <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
        </article>
      </section>

      <section>
        <article className="card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Performance Overview</h2>
              <p className="mt-1 text-xs text-slate-500">Calculated from your completed interviews</p>
            </div>
            <div className="rounded-xl bg-tealish-50 p-2.5 text-tealish-600"><Gauge className="h-5 w-5" /></div>
          </div>
          {loading ? (
            <div className="mt-8 flex items-center gap-3 text-sm text-slate-500">
              <LoaderCircle className="h-5 w-5 animate-spin text-tealish-600" />
              Loading performance data...
            </div>
          ) : completedInterviews.length > 0 && !historyError ? (
            <div className="mt-6 space-y-5">
              {performanceOverview.map((item) => <ProgressBar key={item.label} {...item} />)}
            </div>
          ) : (
            <p className="mt-6 text-sm leading-6 text-slate-500">Complete an interview to unlock performance trends.</p>
          )}
        </article>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Recent Interviews</h2>
            <p className="mt-1 text-sm text-slate-500">Your latest completed interview evaluations.</p>
          </div>
          {completedInterviews.length > 0 && (
            <Link to="/interviews" className="text-sm font-semibold text-navy-700 hover:text-navy-900">View all</Link>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 px-6 py-12 text-sm text-slate-500">
            <LoaderCircle className="h-5 w-5 animate-spin text-tealish-600" />
            Loading interview history...
          </div>
        ) : !historyError && completedInterviews.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy-700">
              <ListChecks className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">Complete your first interview</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Your scores and recent interview history will appear here after your first evaluation.</p>
            <button onClick={startNewInterview} className="primary-btn mt-5">
              Start Interview <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : !historyError ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-semibold">Interview</th>
                  <th className="px-6 py-3 font-semibold">Date</th>
                  <th className="px-6 py-3 font-semibold">Duration</th>
                  <th className="px-6 py-3 font-semibold">Score</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold"><span className="sr-only">Result</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {completedInterviews.slice(0, 5).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-900">{item.role_title}{item.interview_mode && <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{item.interview_mode === 'game' ? 'Arena' : 'Standard'}</span>}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{formatDate(item.completed_at || item.created_at)}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{formatDuration(item.duration_seconds)}</td>
                    <td className="px-6 py-4">
                      {item.overall_score === null || item.overall_score === undefined ? (
                        <span className="text-sm text-slate-400">—</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-navy-800">{item.overall_score}%</span>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-tealish-500" style={{ width: `${item.overall_score}%` }} />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Completed
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={resultLink(item)}
                        aria-label={`View result for ${item.role_title}`}
                        className="text-sm font-semibold text-navy-700 hover:text-navy-900"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
