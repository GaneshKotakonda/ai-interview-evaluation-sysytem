import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Minus, Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProgressBar from '../components/ProgressBar';
import {
  Badge, CountUp, EmptyState, LoadingBlock, PageHeader, Panel, SectionTitle,
} from '../components/ui';
import { api } from '../services/api';
import { STORAGE_KEYS, readInterviewJourney } from '../utils/interviewJourney';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
const capitalize = (text) => (text ? text.replace(/^./, (character) => character.toUpperCase()) : '');

// Normalise both report shapes into [{ label, value }]: the /complete and
// /report responses carry `scores`; very old cached reports only have the
// raw columns. Components without data are dropped rather than shown as 0.
function scoreList(report) {
  const scores = Array.isArray(report.scores)
    ? report.scores
    : [
      { label: 'Answer Quality', value: report.answer_quality_score },
      { label: 'Communication', value: report.communication_score },
      { label: 'Speech Fluency', value: report.speech_fluency_score ?? report.voice_confidence_score },
      { label: 'Camera Engagement', value: report.camera_engagement_score },
    ];
  return scores.filter((score) => score.value !== null && score.value !== undefined);
}

// Read the cached /complete response, but only for the interview requested.
function readCachedReport(interviewId) {
  const cached = localStorage.getItem(STORAGE_KEYS.latestReport);
  if (!cached) return null;
  try {
    const data = JSON.parse(cached);
    return data?.interview_id === interviewId ? data : null;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.latestReport);
    return null;
  }
}

// Score bands shown on the overall scale.
const BANDS = [
  { label: 'Needs work', from: 0, to: 50 },
  { label: 'Developing', from: 50, to: 75 },
  { label: 'Strong', from: 75, to: 101 },
];
const bandFor = (score) => BANDS.find((band) => score >= band.from && score < band.to);

// -------------------------------------------------------------
// BLOCK 2: Presentational sections
// -------------------------------------------------------------
function OverallScore({ score }) {
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const band = hasScore ? bandFor(score) : null;
  const position = hasScore ? Math.max(0, Math.min(score, 100)) : 0;
  // Start the marker at 0 and let it slide to the score after mount.
  const [markerAt, setMarkerAt] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setMarkerAt(position), 150);
    return () => clearTimeout(timer);
  }, [position]);
  return (
    <div className="flex h-full flex-col">
      <p className="text-[13px] text-ink-3">Overall score</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num font-serif text-[5.5rem] leading-[0.85] text-ink">
          {hasScore ? <CountUp value={score} duration={1100} /> : '—'}
        </span>
        <span className="text-lg text-ink-3">/ 100</span>
      </div>
      {band && <p className="mt-3 font-serif text-2xl italic text-ink-2">{band.label}</p>}

      {hasScore && (
        <div className="mt-auto pt-8">
          <div className="relative">
            <div className="flex gap-1">
              {BANDS.map((item) => (
                <span
                  key={item.label}
                  className={`h-1.5 rounded-full ${item === band ? 'bg-ink' : 'bg-line'}`}
                  style={{ width: `${Math.min(item.to, 100) - item.from}%` }}
                />
              ))}
            </div>
            <span
              className="absolute -top-1.5 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-surface bg-ink shadow transition-[left] duration-1000 ease-out"
              style={{ left: `${markerAt}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-ink-4">
            {BANDS.map((item) => <span key={item.label}>{item.label}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

function AdaptiveJourney({ turns }) {
  return (
    <Panel i={3} className="p-6 sm:p-8">
      <SectionTitle
        title="Adaptive Interview Journey"
        description="How each answer moved the interview: difficulty, follow-ups, score and what the system decided next."
      />
      <ol className="relative mt-7 space-y-8 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-line">
        {turns.map((turn, index) => (
          <li key={turn.response_id || turn.index || index} className="reveal relative pl-10" style={{ '--i': index + 4 }}>
            <span className="num absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-surface font-mono text-[11px] text-ink-2">
              {turn.index || index + 1}
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-3">Question {turn.index || index + 1}</span>
              {turn.difficulty && <Badge>{capitalize(turn.difficulty)}</Badge>}
              {turn.is_follow_up && <Badge tone="ink">AI Follow-up</Badge>}
              {turn.topic && <span className="text-ink-3">{turn.topic}</span>}
            </div>
            <h3 className="mt-2 font-serif text-xl leading-snug text-ink">{turn.question}</h3>
            {turn.evaluation?.answer_quality_score != null && (
              <p className="num mt-3 font-mono text-[13px] text-ink">Technical score: {turn.evaluation.answer_quality_score}/100</p>
            )}
            {turn.evaluation?.feedback && <p className="mt-2 text-sm leading-relaxed text-ink-2">{turn.evaluation.feedback}</p>}
            {turn.evaluation?.evaluation_source === 'fallback' && (
              <p className="mt-2 text-xs text-warn">Approximate score: the AI evaluator was unavailable for this answer.</p>
            )}
            {turn.adaptation?.reason && (
              <p className="mt-3 border-l-2 border-line-strong pl-3 text-[13px] text-ink-3">Adaptation: {turn.adaptation.reason}</p>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function FeedbackList({ title, items, positive, i }) {
  const Icon = positive ? Plus : Minus;
  return (
    <Panel i={i} as="article" className="p-6">
      <SectionTitle title={title} />
      {items.length ? (
        <ul className="mt-4 divide-y divide-line">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3 py-3 text-sm leading-relaxed text-ink-2">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${positive ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
                <Icon className="h-3 w-3" strokeWidth={2.5} />
              </span>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-3">Not enough data yet.</p>
      )}
    </Panel>
  );
}

// -------------------------------------------------------------
// BLOCK 3: Page
// -------------------------------------------------------------
// The interview comes from ?id=<uuid> (links from the Dashboard) or, after
// finishing an interview, from the id saved in localStorage.
export default function Report() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get('id');
  const interviewId = requestedId || localStorage.getItem(STORAGE_KEYS.interviewId);
  const localJourney = readInterviewJourney(interviewId);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Show the cached report instantly, then replace it with the saved one.
  useEffect(() => {
    let active = true;
    const cached = readCachedReport(interviewId);
    if (cached) setReport(cached);
    if (!interviewId) {
      setLoading(false);
      return () => { active = false; };
    }
    api.getReport(interviewId)
      .then((data) => { if (active) setReport(data); })
      .catch(() => {
        if (active && !cached) setError('We could not load this report. Return to the dashboard and try again.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [interviewId]);

  if (loading && !report) {
    return <LoadingBlock label="Loading evaluation report…" className="min-h-[50vh]" />;
  }

  if (!report) {
    return (
      <Panel className="mx-auto max-w-xl">
        <EmptyState
          icon={AlertTriangle}
          title="Report unavailable"
          headingLevel="h1"
          action={<button onClick={() => navigate('/dashboard')} className="primary-btn">Back to Dashboard</button>}
        >
          {error || 'Complete an interview to generate a performance report.'}
        </EmptyState>
      </Panel>
    );
  }

  // Prefer this browser's richer local journey; otherwise use the server's.
  const journey = localJourney.length ? localJourney : (Array.isArray(report.turns) ? report.turns : []);
  const scores = scoreList(report);
  const strengths = Array.isArray(report.strengths) ? report.strengths : [];
  const improvements = Array.isArray(report.improvements) ? report.improvements : [];
  const targetRole = report.role_title
    || (!requestedId && localStorage.getItem(STORAGE_KEYS.roleTitle))
    || 'Selected role';
  const summary = report.summary_feedback || report.feedback || 'No summary feedback is available for this report.';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        kicker="Saved evaluation report"
        title="Interview Performance Report"
        description={`Saved answer evaluation and observable camera-engagement signals for ${targetRole}.`}
        actions={(
          <button onClick={() => navigate('/dashboard')} className="secondary-btn">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        )}
      />

      <Panel i={1} className="grid overflow-hidden md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="border-b border-line p-6 sm:p-8 md:border-b-0 md:border-r">
          <OverallScore score={report.overall_score ?? report.overallScore} />
        </div>
        <div className="p-6 sm:p-8">
          <SectionTitle title="Evaluation Breakdown" description="Answer quality, communication, speech fluency and camera engagement." />
          <div className="mt-6 space-y-5">
            {scores.map((score, index) => <ProgressBar key={score.label} {...score} i={index} />)}
          </div>
          <p className="mt-7 text-xs leading-relaxed text-ink-3">
            Scores summarise this practice session; they are not hiring decisions. Camera engagement is an observable
            approximation, and when the camera model was unavailable it is left out and the other parts are re-weighted.
          </p>
        </div>
      </Panel>

      <Panel i={2} className="p-6 sm:p-8">
        <p className="text-[13px] text-ink-3">Summary Feedback</p>
        <blockquote className="mt-3 font-serif text-[1.6rem] leading-snug text-ink">“{summary}”</blockquote>
      </Panel>

      {journey.length > 0 && <AdaptiveJourney turns={journey} />}

      <section className="grid gap-5 lg:grid-cols-2">
        <FeedbackList title="Key Strengths" items={strengths} positive i={4} />
        <FeedbackList title="Areas to Improve" items={improvements} i={5} />
      </section>
    </div>
  );
}
