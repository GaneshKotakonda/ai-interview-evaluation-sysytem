import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  FileText,
  Minus,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProgressBar from '../components/ProgressBar';
import {
  CountUp, EmptyState, LoadingBlock, Notice, PageHeader, Panel, SectionTitle,
} from '../components/ui';
import { api } from '../services/api';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { formatDate, formatDuration } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
const COMPONENTS = [
  { key: 'answer_quality_score', label: 'Answer Quality', short: 'Answer' },
  { key: 'communication_score', label: 'Communication', short: 'Comms' },
  { key: 'speech_fluency_score', label: 'Speech Fluency', short: 'Fluency' },
  { key: 'camera_engagement_score', label: 'Camera Engagement', short: 'Camera' },
];

const hasValue = (value) => value !== null && value !== undefined;

// Average of the non-null values, or null when there are none (e.g. camera
// engagement when the camera model never loaded).
function average(values) {
  const present = values.filter(hasValue).map(Number);
  return present.length ? Math.round(present.reduce((sum, v) => sum + v, 0) / present.length) : null;
}

// Most frequent feedback items across reports.
function topItems(reports, key, limit = 4) {
  const counts = new Map();
  reports.forEach((report) => (report[key] || []).forEach((item) => {
    counts.set(item, (counts.get(item) || 0) + 1);
  }));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([item]) => item);
}

// -------------------------------------------------------------
// BLOCK 2: Overall score trend (single series, 0–100)
// -------------------------------------------------------------
const CHART = { width: 640, height: 240, left: 34, right: 18, top: 18, bottom: 30 };

function ScoreTrendChart({ points }) {
  const [hover, setHover] = useState(null);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (index) => CHART.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value) => CHART.top + plotHeight - (value / 100) * plotHeight;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.score)}`).join(' ');
  const area = points.length > 1
    ? `${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
    : '';
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Overall score across ${points.length} reports, from ${points[0].score} to ${points[points.length - 1].score}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#171611" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#171611" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(tick)} y2={y(tick)} stroke="#e5e2da" strokeWidth="1" strokeDasharray={tick === 0 ? undefined : '2 4'} />
            <text x={CHART.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="11" fill="#868176" fontFamily="Geist Mono, monospace">{tick}</text>
          </g>
        ))}
        {area && <path d={area} fill="url(#trend-fill)" className="fade-in" />}
        {active && (
          <line x1={x(hover)} x2={x(hover)} y1={CHART.top} y2={CHART.top + plotHeight} stroke="#b3ada1" strokeWidth="1" />
        )}
        <path d={path} fill="none" stroke="#171611" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pathLength="100" className="draw" style={{ '--len': 100 }} />
        {points.map((point, index) => (
          <g key={point.id}>
            <circle cx={x(index)} cy={y(point.score)} r={hover === index ? 5.5 : 4} fill="#171611" stroke="#ffffff" strokeWidth="2" className="transition-all duration-200" />
            {/* Hit target wider than the marker. */}
            <rect
              x={x(index) - Math.max(12, plotWidth / points.length / 2)}
              y={CHART.top}
              width={Math.max(24, plotWidth / points.length)}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          </g>
        ))}
        {points.length > 1 && (
          <>
            <text x={x(0)} y={CHART.height - 8} textAnchor="start" fontSize="11" fill="#868176">{points[0].label}</text>
            <text x={x(points.length - 1)} y={CHART.height - 8} textAnchor="end" fontSize="11" fill="#868176">{points[points.length - 1].label}</text>
          </>
        )}
      </svg>
      {active && (
        <div
          className="scale-in pointer-events-none absolute -translate-x-1/2 rounded-control border border-line bg-surface px-3 py-2 text-xs shadow-lift"
          style={{ left: `${(x(hover) / CHART.width) * 100}%`, top: 0 }}
        >
          <p className="num font-mono text-sm text-ink">{active.score}/100</p>
          <p className="mt-0.5 text-ink-2">{active.role}</p>
          <p className="text-ink-3">{active.label}</p>
        </div>
      )}
    </div>
  );
}

function Change({ latest, previous }) {
  if (!hasValue(latest) || !hasValue(previous)) return <span className="text-xs text-ink-3">First report</span>;
  const delta = latest - previous;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const tone = delta > 0 ? 'text-ok' : delta < 0 ? 'text-bad' : 'text-ink-3';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${tone}`}>
      <Icon className="h-3.5 w-3.5" /> {delta > 0 ? '+' : ''}{delta} vs previous
    </span>
  );
}

// -------------------------------------------------------------
// BLOCK 3: Page — progress across every saved Standard report
// -------------------------------------------------------------
export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!user?.uid) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    api.getUserReports(user.uid)
      .then((data) => { if (active) setReports(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setError('We could not load your reports. Please try again shortly.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.uid]);

  // Oldest → newest for the trend; the table shows newest first.
  const chronological = useMemo(
    () => [...reports].sort((a, b) => new Date(a.evaluated_at || a.created_at) - new Date(b.evaluated_at || b.created_at)),
    [reports],
  );
  const trendPoints = chronological
    .filter((report) => hasValue(report.overall_score))
    .map((report) => ({
      id: report.interview_id,
      score: Number(report.overall_score),
      role: report.role_title,
      label: formatDate(report.evaluated_at || report.created_at),
    }));
  const componentAverages = COMPONENTS
    .map(({ key, label }) => ({ label, value: average(reports.map((report) => report[key])) }))
    .filter((item) => item.value !== null);
  const latest = trendPoints[trendPoints.length - 1]?.score;
  const previous = trendPoints[trendPoints.length - 2]?.score;
  const strengths = topItems(reports, 'strengths');
  const improvements = topItems(reports, 'improvements');

  const startNewInterview = () => {
    clearInterviewProgress();
    navigate('/readiness');
  };

  if (loading) return <LoadingBlock label="Loading reports…" className="min-h-[50vh]" />;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        kicker="Progress"
        title="Reports"
        description="How your Standard interview evaluations have changed over time."
      />

      {error ? (
        <Notice tone="bad">{error}</Notice>
      ) : reports.length === 0 ? (
        <Panel>
          <EmptyState
            icon={FileText}
            title="No reports yet"
            action={<button onClick={startNewInterview} className="primary-btn">Start Interview <ArrowRight className="h-4 w-4" /></button>}
          >
            Complete a Standard interview to receive your first evaluation report.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Panel i={1} as="article" className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <SectionTitle title="Overall Score Trend" description={`${trendPoints.length} evaluated interviews`} />
                <div className="text-right">
                  <p className="num font-serif text-4xl leading-none text-ink">
                    {hasValue(latest) ? <CountUp value={latest} /> : '—'}
                  </p>
                  <p className="mt-1.5 text-xs text-ink-3">latest</p>
                </div>
              </div>
              <div className="mt-1 flex justify-end"><Change latest={latest} previous={previous} /></div>
              <div className="mt-3">
                {trendPoints.length ? <ScoreTrendChart points={trendPoints} /> : <p className="text-sm text-ink-3">No scored reports yet.</p>}
              </div>
            </Panel>
            <Panel i={2} as="article" className="p-6">
              <SectionTitle title="Average Breakdown" description="Across all saved reports" />
              <div className="mt-6 space-y-5">
                {componentAverages.map((item, index) => <ProgressBar key={item.label} {...item} i={index} />)}
              </div>
            </Panel>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            {[['Recurring Strengths', strengths, 'ok'], ['Recurring Areas to Improve', improvements, 'warn']].map(([title, items, tone], index) => (
              <Panel key={title} i={index + 3} as="article" className="p-6">
                <SectionTitle title={title} />
                {items.length ? (
                  <ul className="mt-3 divide-y divide-line">
                    {items.map((item) => (
                      <li key={item} className="flex items-center gap-3 py-2.5 text-sm text-ink-2">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'ok' ? 'bg-ok' : 'bg-warn'}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-ink-3">Not enough data yet.</p>
                )}
              </Panel>
            ))}
          </section>

          <Panel i={5} className="overflow-hidden">
            <div className="border-b border-line px-6 py-5">
              <SectionTitle title="All Reports" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="text-xs text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-6 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Overall</th>
                    {COMPONENTS.map(({ key, label, short }) => (
                      <th key={key} className="px-3 py-3 font-medium"><abbr title={label} className="no-underline">{short}</abbr></th>
                    ))}
                    <th className="px-6 py-3 font-medium"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {reports.map((report) => (
                    <tr key={report.interview_id} className="group transition hover:bg-paper">
                      <td className="px-6 py-3.5 text-sm font-medium text-ink">{report.role_title}</td>
                      <td className="px-4 py-3.5 text-[13px] text-ink-2">{formatDate(report.evaluated_at || report.created_at)}</td>
                      <td className="num px-4 py-3.5 font-mono text-[13px] text-ink-2">{formatDuration(report.duration_seconds)}</td>
                      <td className="num px-4 py-3.5 font-mono text-sm text-ink">{hasValue(report.overall_score) ? `${report.overall_score}%` : '—'}</td>
                      {COMPONENTS.map(({ key }) => (
                        <td key={key} className="num px-3 py-3.5 font-mono text-[13px] text-ink-3">{hasValue(report[key]) ? report[key] : '—'}</td>
                      ))}
                      <td className="px-6 py-3.5 text-right">
                        <Link
                          to={`/report?id=${encodeURIComponent(report.interview_id)}`}
                          aria-label={`Open report for ${report.role_title}`}
                          className="inline-flex items-center gap-1 text-[13px] text-ink-2 transition hover:text-ink"
                        >
                          Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                        </Link>
                      </td>
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
