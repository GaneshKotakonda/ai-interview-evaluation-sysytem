import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  FileText,
  LoaderCircle,
  Minus,
  TrendingUp,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProgressBar from '../components/ProgressBar';
import { api } from '../services/api';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { formatDate, formatDuration } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
const COMPONENTS = [
  { key: 'answer_quality_score', label: 'Answer Quality' },
  { key: 'communication_score', label: 'Communication' },
  { key: 'speech_fluency_score', label: 'Speech Fluency' },
  { key: 'camera_engagement_score', label: 'Camera Engagement' },
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
const CHART = { width: 640, height: 220, left: 36, right: 16, top: 16, bottom: 28 };

function ScoreTrendChart({ points }) {
  const [hover, setHover] = useState(null);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (index) => CHART.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value) => CHART.top + plotHeight - (value / 100) * plotHeight;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.score)}`).join(' ');
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
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={CHART.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="11" fill="#94a3b8">{tick}</text>
          </g>
        ))}
        {active && (
          <line x1={x(hover)} x2={x(hover)} y1={CHART.top} y2={CHART.top + plotHeight} stroke="#cbd5e1" strokeWidth="1" />
        )}
        <path d={path} fill="none" stroke="#14a891" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={point.id}>
            <circle cx={x(index)} cy={y(point.score)} r={hover === index ? 5 : 4} fill="#14a891" stroke="#ffffff" strokeWidth="2" />
            {/* Hit target wider than the marker. */}
            <rect
              x={x(index) - Math.max(12, plotWidth / points.length / 2)}
              y={CHART.top}
              width={Math.max(24, plotWidth / points.length)}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
            />
          </g>
        ))}
        {points.length > 1 && (
          <>
            <text x={x(0)} y={CHART.height - 8} textAnchor="start" fontSize="11" fill="#94a3b8">{points[0].label}</text>
            <text x={x(points.length - 1)} y={CHART.height - 8} textAnchor="end" fontSize="11" fill="#94a3b8">{points[points.length - 1].label}</text>
          </>
        )}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-card"
          style={{ left: `${(x(hover) / CHART.width) * 100}%`, top: 0 }}
        >
          <p className="font-semibold text-slate-900">{active.score}/100</p>
          <p className="text-slate-500">{active.role}</p>
          <p className="text-slate-400">{active.label}</p>
        </div>
      )}
    </div>
  );
}

function Change({ latest, previous }) {
  if (!hasValue(latest) || !hasValue(previous)) return <span className="text-xs text-slate-400">First report</span>;
  const delta = latest - previous;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const tone = delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-700' : 'text-slate-500';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone}`}>
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

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-slate-500">
        <LoaderCircle className="h-5 w-5 animate-spin text-tealish-600" /> Loading reports...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">Progress</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Reports</h1>
        <p className="mt-2 text-slate-500">How your Standard interview evaluations have changed over time.</p>
      </section>

      {error ? (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : reports.length === 0 ? (
        <section className="card px-6 py-12 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy-700">
            <FileText className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">No reports yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Complete a Standard interview to receive your first evaluation report.
          </p>
          <button onClick={startNewInterview} className="primary-btn mt-5">Start Interview <ArrowRight className="h-4 w-4" /></button>
        </section>
      ) : (
        <>
          <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <article className="card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Overall Score Trend</h2>
                  <p className="mt-1 text-xs text-slate-500">{trendPoints.length} evaluated interviews</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900">{hasValue(latest) ? latest : '—'}<span className="text-sm font-medium text-slate-400"> latest</span></p>
                  <Change latest={latest} previous={previous} />
                </div>
              </div>
              <div className="mt-4">
                {trendPoints.length ? <ScoreTrendChart points={trendPoints} /> : <p className="text-sm text-slate-500">No scored reports yet.</p>}
              </div>
            </article>
            <article className="card p-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-tealish-600" />
                <h2 className="text-lg font-bold text-slate-900">Average Breakdown</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">Across all saved reports</p>
              <div className="mt-6 space-y-5">
                {componentAverages.map((item) => <ProgressBar key={item.label} {...item} />)}
              </div>
            </article>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            {[['Recurring Strengths', strengths], ['Recurring Areas to Improve', improvements]].map(([title, items]) => (
              <article key={title} className="card p-6">
                <h2 className="text-lg font-bold text-slate-900">{title}</h2>
                {items.length ? (
                  <ul className="mt-4 space-y-2">
                    {items.map((item) => <li key={item} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{item}</li>)}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">Not enough data yet.</p>
                )}
              </article>
            ))}
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-6 py-5">
              <h2 className="text-lg font-bold text-slate-900">All Reports</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Role</th>
                    <th className="px-6 py-3 font-semibold">Date</th>
                    <th className="px-6 py-3 font-semibold">Duration</th>
                    <th className="px-6 py-3 font-semibold">Overall</th>
                    {COMPONENTS.map(({ key, label }) => <th key={key} className="px-4 py-3 font-semibold">{label}</th>)}
                    <th className="px-6 py-3 font-semibold"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.map((report) => (
                    <tr key={report.interview_id} className="hover:bg-slate-50/70">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900">{report.role_title}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{formatDate(report.evaluated_at || report.created_at)}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{formatDuration(report.duration_seconds)}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-navy-800">{hasValue(report.overall_score) ? `${report.overall_score}%` : '—'}</td>
                      {COMPONENTS.map(({ key }) => (
                        <td key={key} className="px-4 py-4 text-sm text-slate-600">{hasValue(report[key]) ? `${report[key]}%` : '—'}</td>
                      ))}
                      <td className="px-6 py-4 text-right">
                        <Link
                          to={`/report?id=${encodeURIComponent(report.interview_id)}`}
                          aria-label={`Open report for ${report.role_title}`}
                          className="text-sm font-semibold text-navy-700 hover:text-navy-900"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
