import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Clock3, LoaderCircle, Sparkles, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
        : 'Completed · Rubric cosine similarity matched',
      complete: !evaluating && !evaluationError,
    },
    {
      label: 'RAG Answer Evaluation',
      state: evaluating
        ? 'Aggregating saved technical scores...'
        : 'Completed · Multi-criteria scores computed',
      complete: !evaluating && !evaluationError,
    },
    {
      label: 'Communication Analysis',
      state: evaluating
        ? 'Combining saved communication metrics...'
        : `Completed · ${totalFillers} filler words analyzed`,
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
  return (
    <div className="mx-auto max-w-4xl py-3 sm:py-8">
      <section className="card overflow-hidden">
        {/* Header Summary Banner */}
        <div className="border-b border-slate-100 p-6 text-center sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">
            Submission Complete
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Interview Completed!
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-slate-500">
            Your responses and submitted media have been saved for this interview.
          </p>

          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Questions Answered</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{journey.length} {journey.length === 1 ? 'Question' : 'Questions'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <Clock3 className="mx-auto h-4 w-4 text-navy-700" />
              <p className="mt-2 text-xs text-slate-500">Interview Duration</p>
              <p className="mt-1 font-bold text-slate-900">{formatDuration(duration)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Evaluation Status</p>
              <p className="mt-1 inline-flex items-center gap-1.5 font-bold text-emerald-700">
                {evaluating ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin text-tealish-600" />
                    Grading
                  </>
                ) : evaluationError ? 'Report pending' : (
                  <>
                    <Check className="h-4 w-4" />
                    Evaluated
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* AI Analysis Multi-Phase Checklist */}
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-navy-50 p-2.5 text-navy-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Live AI Evaluation Processing</h2>
              <p className="text-sm text-slate-500">
                {evaluating
                  ? 'Combining saved answer evaluations and camera metrics into your final report.'
                  : evaluationError ? 'Report generation needs a retry.' : 'Your final report is ready.'}
              </p>
            </div>
          </div>

          {evaluationError && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{evaluationError}</p>
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {analysisItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-4"
              >
                <div
                  className={`grid h-9 w-9 place-items-center rounded-full ${
                    item.complete ? 'bg-emerald-50 text-emerald-600' : 'bg-navy-50 text-navy-700'
                  }`}
                >
                  {item.complete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <LoaderCircle className="h-4 w-4 animate-spin text-tealish-600" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                  <p className={`text-xs ${item.complete ? 'text-emerald-600' : 'text-navy-600'}`}>
                    {evaluationError && !item.complete ? 'Waiting for report generation' : item.state}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {evaluationError && interviewId && <button className="secondary-btn mt-6" disabled={evaluating} onClick={() => setAttempt((value) => value + 1)}>Retry Report Generation</button>}

          {/* Navigation to Full Performance Report */}
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => navigate('/report')}
              disabled={evaluating || !evaluationReport}
              className="primary-btn"
            >
              {evaluating ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Finalizing AI Report...
                </>
              ) : (
                'View Evaluation Report'
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
