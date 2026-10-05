import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, ListChecks } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProgressBar from '../components/ProgressBar';
import {
  EmptyState, Notice, PageHeader, Panel, ScoreBar, SectionTitle, Skeleton, Stat, StatRow,
} from '../components/ui';
import { api } from '../services/api';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { formatDate, formatDuration, isCompleted, modeLabel, resultLink } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Small trend line of the most recent scores (oldest → newest).
function Sparkline({ values }) {
  if (values.length < 2) return null;
  const width = 220;
  const height = 56;
  const x = (index) => 4 + (index / (values.length - 1)) * (width - 8);
  const y = (value) => height - 6 - (value / 100) * (height - 12);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" role="img" aria-label={`Last ${values.length} scores, latest ${values[last]}`}>
      <line x1="0" x2={width} y1={y(50)} y2={y(50)} stroke="#e5e2da" strokeDasharray="3 4" />
      <polyline
        points={points}
        fill="none"
        stroke="#171611"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength="100"
        className="draw"
        style={{ '--len': 100 }}
      />
      <circle cx={x(last)} cy={y(values[last])} r="3.5" fill="#171611" stroke="#fff" strokeWidth="2" className="fade-in" />
    </svg>
  );
}

function ModeCard({ dark = false, index, title, description, meta, action, i }) {
  return (
    <Panel
      as="article"
      i={i}
      className={`group flex flex-col p-6 transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lift sm:p-7 ${
        dark ? '!border-ink !bg-ink text-paper' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <span className={`num font-mono text-xs ${dark ? 'text-paper/50' : 'text-ink-3'}`}>{index}</span>
        <ArrowUpRight className={`h-4 w-4 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${dark ? 'text-paper/50' : 'text-ink-4'}`} />
      </div>
      <h2 className="mt-8 font-serif text-[2rem] leading-none">{title}</h2>
      <p className={`mt-3 max-w-md text-sm leading-relaxed ${dark ? 'text-paper/65' : 'text-ink-2'}`}>{description}</p>
      <ul className={`mb-7 mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] ${dark ? 'text-paper/55' : 'text-ink-3'}`}>
        {meta.map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span className={`h-1 w-1 rounded-full ${dark ? 'bg-paper/40' : 'bg-ink-4'}`} />
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-auto">{action}</div>
    </Panel>
  );
}

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
  const recentScores = scoredInterviews
    .slice(0, 8)
    .map((item) => Number(item.overall_score))
    .reverse();

  const unavailable = loading || historyError;
  const stats = [
    { label: 'Total Interviews', value: unavailable ? '—' : interviews.length, hint: 'All sessions' },
    { label: 'Average Score', value: unavailable || averageScore === null ? '—' : averageScore, suffix: '%', hint: 'Scored interviews' },
    { label: 'Best Score', value: unavailable || bestScore === null ? '—' : bestScore, suffix: '%', hint: 'Highest result' },
    { label: 'Completed Interviews', value: unavailable ? '—' : completedInterviews.length, hint: 'Fully evaluated' },
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

  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        kicker={today}
        title={`${greeting()}, ${firstName}`}
        description="Ready to improve your next interview? Pick a format below, or revisit an earlier result."
      />

      {historyError && <Notice tone="bad">{historyError}</Notice>}

      <StatRow i={1}>
        {stats.map((stat) => <Stat key={stat.label} {...stat} />)}
      </StatRow>

      <section aria-label="Choose your interview experience" className="grid gap-5 lg:grid-cols-2">
        <ModeCard
          i={2}
          index="01"
          title="Standard Interview"
          description="A realistic interview with adaptive difficulty, AI follow-up questions, camera engagement and a professional evaluation report."
          meta={['Adaptive Questions', 'Dynamic Difficulty', 'AI Follow-ups', 'Professional Evaluation']}
          action={<button onClick={startNewInterview} className="primary-btn">Start Standard Interview <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>}
        />
        <ModeCard
          dark
          i={3}
          index="02"
          title="Interview Arena"
          description="Shorter, game-style practice. Answer adaptive challenges in text, build streaks and finish with a boss round."
          meta={['Adaptive Challenges', 'XP & Levels', 'Streaks', 'Boss Round']}
          action={(
            <button onClick={() => navigate('/arena')} className="btn bg-paper text-ink hover:bg-white">
              Enter Interview Arena <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel i={4} className="overflow-hidden">
          <div className="border-b border-line px-6 py-5">
            <SectionTitle
              title="Recent Interviews"
              description="Your latest completed evaluations."
              action={completedInterviews.length > 0 && <Link to="/interviews" className="text-[13px] text-ink-2 transition hover:text-ink">View all</Link>}
            />
          </div>

          {loading ? (
            <div className="space-y-4 px-6 py-6">
              {[0, 1, 2].map((row) => <Skeleton key={row} className="h-10 w-full" />)}
            </div>
          ) : !historyError && completedInterviews.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="Complete your first interview"
              headingLevel="h3"
              action={<button onClick={startNewInterview} className="primary-btn">Start Interview <ArrowRight className="h-4 w-4" /></button>}
            >
              Your scores and recent interview history will appear here after your first evaluation.
            </EmptyState>
          ) : !historyError ? (
            <ul className="divide-y divide-line">
              {completedInterviews.slice(0, 5).map((item, index) => (
                <li key={item.id} className="reveal" style={{ '--i': index + 5 }}>
                  <Link
                    to={resultLink(item)}
                    aria-label={`View result for ${item.role_title}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4 transition hover:bg-paper sm:grid-cols-[minmax(0,1fr)_120px_140px_20px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{item.role_title}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">
                        {modeLabel(item.interview_mode)} · {formatDate(item.completed_at || item.created_at)}
                      </span>
                    </span>
                    <span className="hidden text-[13px] text-ink-3 sm:block">{formatDuration(item.duration_seconds)}</span>
                    <span className="flex items-center justify-end gap-3">
                      {item.overall_score === null || item.overall_score === undefined ? (
                        <span className="text-sm text-ink-4">—</span>
                      ) : (
                        <>
                          <ScoreBar value={item.overall_score} className="hidden w-16 sm:inline-block" />
                          <span className="num w-10 text-right font-mono text-sm text-ink">{item.overall_score}%</span>
                        </>
                      )}
                    </span>
                    <ArrowRight className="hidden h-4 w-4 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel i={5} className="flex flex-col p-6">
          <SectionTitle title="Performance Overview" description="Calculated from your completed interviews" />
          {loading ? (
            <div className="mt-6 space-y-5">
              {[0, 1, 2].map((row) => <Skeleton key={row} className="h-6 w-full" />)}
            </div>
          ) : completedInterviews.length > 0 && !historyError ? (
            <>
              <div className="mt-5">
                <Sparkline values={recentScores} />
              </div>
              <div className="mt-6 space-y-5">
                {performanceOverview.map((item, index) => <ProgressBar key={item.label} {...item} i={index} />)}
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm leading-relaxed text-ink-3">Complete an interview to unlock performance trends.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
