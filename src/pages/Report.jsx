import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, Sparkles, Trophy } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProgressBar from '../components/ProgressBar';
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

// -------------------------------------------------------------
// BLOCK 2: Presentational sections
// -------------------------------------------------------------
function OverallScoreCard({ score }) {
  return (
    <article className="rounded-2xl bg-navy-900 p-6 text-white shadow-card">
      <div className="flex items-center gap-3">
        <Trophy className="h-5 w-5 text-teal-200" />
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Overall Score</p>
      </div>
      <div className="mt-8 flex items-end gap-2">
        <span className="text-6xl font-bold">{score ?? '—'}</span>
        <span className="pb-2 text-xl text-slate-400">/ 100</span>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        Scores summarise technical coverage and communication in this practice session; they are not hiring decisions.
      </p>
      <div className="mt-8 rounded-xl bg-white/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-teal-200">
          <Info className="h-4 w-4" /> Evaluation methodology
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Camera engagement is an observable approximation, not a psychological assessment. When the camera model was
          unavailable it is left out and the other components are re-weighted.
        </p>
      </div>
    </article>
  );
}

function ScoreBreakdown({ scores }) {
  return (
    <article className="card p-6 sm:p-7">
      <h2 className="text-lg font-bold">Evaluation Breakdown</h2>
      <p className="mt-1 text-sm text-slate-500">Answer Quality, Communication, Speech Fluency, and Camera Engagement.</p>
      <div className="mt-7 grid gap-6 sm:grid-cols-2">
        {scores.map((score) => (
          <div key={score.label} className="rounded-xl border border-slate-200 p-4">
            <ProgressBar {...score} />
            <p className="mt-3 text-xs text-slate-400">Saved evaluation metric</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function AdaptiveJourney({ turns }) {
  return (
    <section className="card p-6 sm:p-7">
      <h2 className="text-lg font-bold">Adaptive Interview Journey</h2>
      <p className="mt-1 text-sm text-slate-500">
        Each turn shows the saved difficulty, topic, follow-up status, answer score, and adaptation outcome.
      </p>
      <ol className="mt-5 space-y-4">
        {turns.map((turn, index) => (
          <li key={turn.response_id || turn.index || index} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              <span>Question {turn.index || index + 1}</span>
              {turn.difficulty && <span className="rounded-full bg-slate-100 px-2.5 py-1">{capitalize(turn.difficulty)}</span>}
              {turn.is_follow_up && <span className="rounded-full bg-teal-50 px-2.5 py-1 text-teal-700">AI Follow-up</span>}
              {turn.topic && <span>{turn.topic}</span>}
            </div>
            <h3 className="mt-2 font-semibold">{turn.question}</h3>
            {turn.evaluation?.answer_quality_score != null && (
              <p className="mt-2 text-sm text-slate-600">Technical score: {turn.evaluation.answer_quality_score}/100</p>
            )}
            {turn.evaluation?.feedback && <p className="mt-2 text-sm text-slate-600">{turn.evaluation.feedback}</p>}
            {turn.evaluation?.evaluation_source === 'fallback' && (
              <p className="mt-2 text-xs text-amber-700">Approximate score: the AI evaluator was unavailable for this answer.</p>
            )}
            {turn.adaptation?.reason && <p className="mt-2 text-sm text-slate-600">Adaptation: {turn.adaptation.reason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function FeedbackList({ title, items, icon: Icon }) {
  return (
    <article className="card p-6">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5" />
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      {items.length ? (
        <ul className="mt-5 space-y-3">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-slate-500">Not enough data yet.</p>
      )}
    </article>
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
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
        <Loader2 className="h-10 w-10 animate-spin text-tealish-600" />
        <h1 className="mt-4 text-xl font-bold">Loading evaluation report</h1>
      </div>
    );
  }

  if (!report) {
    return (
      <section className="card mx-auto max-w-xl p-8 text-center">
        <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" />
        <h1 className="mt-4 text-2xl font-bold">Report unavailable</h1>
        <p className="mt-2 text-slate-600">{error || 'Complete an interview to generate a performance report.'}</p>
        <button onClick={() => navigate('/dashboard')} className="primary-btn mt-6">Back to Dashboard</button>
      </section>
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Saved evaluation report
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Interview Performance Report</h1>
          <p className="mt-2 max-w-2xl text-slate-500">
            Saved answer evaluation and observable camera-engagement signals for {targetRole}.
          </p>
        </div>
        <button onClick={() => navigate('/dashboard')} className="secondary-btn">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>
      </section>

      <section className="grid gap-6 lg:grid-cols-[330px_1fr]">
        <OverallScoreCard score={report.overall_score ?? report.overallScore} />
        <ScoreBreakdown scores={scores} />
      </section>

      {journey.length > 0 && <AdaptiveJourney turns={journey} />}

      <section className="grid gap-6 lg:grid-cols-2">
        <FeedbackList title="Key Strengths" items={strengths} icon={CheckCircle2} />
        <FeedbackList title="Areas to Improve" items={improvements} icon={AlertTriangle} />
      </section>

      <section className="card p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <Sparkles className="h-5 w-5 text-navy-700" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tealish-600">Evaluation summary</p>
            <h2 className="mt-1 text-lg font-bold">Summary Feedback</h2>
            <p className="mt-3 max-w-4xl leading-7 text-slate-600">
              {report.summary_feedback || report.feedback || 'No summary feedback is available for this report.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
