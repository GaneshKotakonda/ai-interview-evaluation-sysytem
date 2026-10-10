import { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  FlowSteps, Notice, Panel, SectionTitle, Spinner,
} from '../components/ui';
import { api } from '../services/api';
import { STORAGE_KEYS, readInterviewJourney } from '../utils/interviewJourney';

// -------------------------------------------------------------
// BLOCK 1: Utility Functions
// -------------------------------------------------------------
// Formats the recorded interview duration in minutes and seconds
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export default function InterviewComplete() {
  const navigate = useNavigate();

  // -------------------------------------------------------------
  // BLOCK 2: Component State & Local Storage Data
  // -------------------------------------------------------------
  const duration = Number(localStorage.getItem(STORAGE_KEYS.duration));
  const interviewId = localStorage.getItem(STORAGE_KEYS.interviewId);
  const endedReason = localStorage.getItem(STORAGE_KEYS.endedEarly);
  const endedEarly = Boolean(endedReason);
  const endReason = endedReason === 'away' ? 'away' : 'violations';

  // Real camera measurements from the interview, or null when the vision
  // model never produced data (the report then omits camera engagement).
  let visionMetrics = null;
  try {
    visionMetrics = JSON.parse(localStorage.getItem(STORAGE_KEYS.visionMetrics) || 'null');
  } catch {
    visionMetrics = null;
  }

  // AI Evaluation progress states
  const journey = readInterviewJourney(interviewId);
  const [attempt, setAttempt] = useState(0);
  const [evaluating, setEvaluating] = useState(true);
  const [evaluationError, setEvaluationError] = useState(null);
  const [evaluationReport, setEvaluationReport] = useState(null);

  // -------------------------------------------------------------
  // BLOCK 3: Trigger Real RAG AI Evaluation in Backend
  // -------------------------------------------------------------
  // Calls /complete to aggregate saved turn evaluations and vision metrics.
  useEffect(() => {
    let isMounted = true;

    async function triggerAiEvaluation() {
      if (!interviewId) {
        setEvaluating(false);
        setEvaluationError('No interview session was found. Please return to the dashboard.');
        return;
      }

      try {
        setEvaluating(true);
        setEvaluationError(null);

        const report = await api.completeInterview(
          interviewId,
          visionMetrics || {},
          Number.isFinite(duration) && duration > 0 ? duration : 0,
          // Proctoring ended the interview: unanswered questions score 0.
          ...(endedEarly ? [true, endReason] : []),
        );

        if (!isMounted) return;

        setEvaluationReport(report);
        // Cache report locally for immediate display in Report.jsx
        localStorage.setItem(STORAGE_KEYS.latestReport, JSON.stringify(report));
      } catch (err) {
        if (isMounted) {
          setEvaluationError(
            'Your answers are saved, but the final report could not be generated. Please retry.'
          );
        }
      } finally {
        if (isMounted) setEvaluating(false);
      }
    }

    triggerAiEvaluation();

    return () => {
      isMounted = false;
    };
  }, [duration, interviewId, attempt]);

  // -------------------------------------------------------------
  // BLOCK 4: Dynamic Analysis Checklist Items
  // -------------------------------------------------------------
  const totalFillers = evaluationReport?.nlp_metrics?.total_fillers ?? 0;
  const eyeContactVal = visionMetrics?.eyeContact;

  const analysisItems = [
    {
      label: 'Speech & Text Alignment',
      state: evaluating
        ? 'Collecting saved answer evaluations...'
        : 'Rubric similarity matched',
      complete: !evaluating && !evaluationError,
    },
    {
      label: 'RAG Answer Evaluation',
      state: evaluating
        ? 'Aggregating saved technical scores...'
        : 'Multi-criteria scores computed',
      complete: !evaluating && !evaluationError,
    },
    {
      label: 'Communication Analysis',
      state: evaluating
        ? 'Combining saved communication metrics...'
        : evaluationReport?.speech_metrics?.words_per_minute
          ? `${evaluationReport.speech_metrics.words_per_minute} words/min · ${evaluationReport.speech_metrics.fillers_per_minute} fillers/min`
          : `${totalFillers} filler words analysed`,
      complete: !evaluating && !evaluationError,
    },
    {
      label: 'Camera Engagement',
      state: Number.isFinite(eyeContactVal)
        ? `Approximate screen gaze: ${eyeContactVal}%`
        : 'Not measured · camera analysis was unavailable',
      complete: true,
    },
  ];

  // -------------------------------------------------------------
  // BLOCK 5: Render Submission Confirmation & AI Status View
  // -------------------------------------------------------------
  const facts = [
    ['Questions answered', `${journey.length} ${journey.length === 1 ? 'Question' : 'Questions'}`],
    ['Duration', formatDuration(duration)],
    ['Evaluation', evaluating ? 'Grading…' : evaluationError ? 'Report pending' : 'Evaluated'],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <FlowSteps current={2} />

      <Panel className="overflow-hidden">
        <div className="px-6 pb-8 pt-10 text-center sm:px-10">
          {/* Drawn check mark */}
          <svg viewBox="0 0 64 64" className="mx-auto h-16 w-16" aria-hidden="true">
            <circle cx="32" cy="32" r="29" fill="none" stroke="#171611" strokeWidth="2" pathLength="100" className="draw" style={{ '--len': 100 }} />
            <path d="M20 33 l8 8 l16 -17" fill="none" stroke="#171611" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="100" className="draw" style={{ '--len': 100, '--delay': '450ms' }} />
          </svg>
          <h1 className="reveal mt-6 font-serif text-[2.4rem] tracking-[-0.02em] leading-none text-ink" style={{ '--i': 2 }}>{endedEarly ? 'Interview ended early' : 'Interview complete'}</h1>
          <p className="reveal mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-2" style={{ '--i': 3 }}>
            {endedEarly
              ? `${endReason === 'away' ? 'You stayed outside the interview for too long.' : 'The interview ended after repeated integrity warnings.'} Your answers so far are saved; unanswered questions score 0.`
              : 'Your answers and recordings are saved. We are combining every turn into your final report.'}
          </p>

          <dl className="reveal mx-auto mt-8 grid max-w-xl grid-cols-3 divide-x divide-line rounded-control border border-line" style={{ '--i': 4 }}>
            {facts.map(([label, value]) => (
              <div key={label} className="px-3 py-4">
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-t border-line bg-paper/60 px-6 py-6 sm:px-10">
          <SectionTitle
            title="Building your report"
            description={evaluating
              ? 'Combining saved answer evaluations and camera metrics.'
              : evaluationError ? 'Report generation needs a retry.' : 'Your final report is ready.'}
          />

          {evaluationError && <Notice tone="warn" className="mt-4">{evaluationError}</Notice>}
          {evaluationReport?.integrity?.verdict === 'invalid' && (
            <Notice tone="bad" className="mt-4">
              This interview is invalid: the candidate&apos;s identity could not be confirmed throughout, so it scores 0. The report shows the evidence.
            </Notice>
          )}
          {evaluationReport?.integrity?.verdict === 'review' && (
            <Notice tone="warn" className="mt-4">
              Integrity issues were found and some answers were penalised. The report&apos;s Integrity section explains why.
            </Notice>
          )}

          <ol className="mt-5 space-y-1">
            {analysisItems.map((item, index) => (
              <li key={item.label} className="reveal flex items-center gap-3 py-2" style={{ '--i': index + 5 }}>
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition duration-300 ${
                    item.complete ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink-3'
                  }`}
                >
                  {item.complete ? <Check key="done" className="scale-in h-3.5 w-3.5" strokeWidth={2.5} /> : <Spinner className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 text-sm text-ink">{item.label}</span>
                <span className={`text-right text-xs ${item.complete ? 'text-ink-3' : 'text-ink-2'}`}>
                  {evaluationError && !item.complete ? 'Waiting for report generation' : item.state}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            {evaluationError && interviewId ? (
              <button className="secondary-btn" disabled={evaluating} onClick={() => setAttempt((value) => value + 1)}>
                Retry Report Generation
              </button>
            ) : <span />}
            <button
              onClick={() => navigate('/report')}
              disabled={evaluating || !evaluationReport}
              className="primary-btn"
            >
              {evaluating ? <><Spinner /> Finalizing AI Report…</> : <>View Evaluation Report <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
