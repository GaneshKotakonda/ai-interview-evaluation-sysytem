import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ProgressBar from '../components/ProgressBar';
import { reportData as fallbackMockData } from '../data/mockData';
import { api } from '../services/api';

export default function Report() {
  const navigate = useNavigate();

  // -------------------------------------------------------------
  // BLOCK 1: Component State
  // -------------------------------------------------------------
  // Live evaluation report retrieved from PostgreSQL or local cache
  const [report, setReport] = useState(null);
  // Loading state while fetching from database
  const [loading, setLoading] = useState(true);
  // Flag indicating whether the displayed report is real AI evaluation
  const [isLiveAiReport, setIsLiveAiReport] = useState(false);

  // -------------------------------------------------------------
  // BLOCK 2: Fetch Live Evaluation Report from Backend
  // -------------------------------------------------------------
  // Attempts to load report from PostgreSQL via GET /api/interviews/{id}/report,
  // falling back to local session cache or mockData if offline.
  useEffect(() => {
    let isMounted = true;

    async function loadEvaluationReport() {
      const interviewId = localStorage.getItem('current-interview-id');
      const cachedReportStr = localStorage.getItem('latest-evaluation-report');

      // 1. Try local cache first for instant display
      if (cachedReportStr) {
        try {
          const cached = JSON.parse(cachedReportStr);
          if (cached && (cached.overall_score || cached.scores)) {
            setReport(cached);
            setIsLiveAiReport(true);
          }
        } catch (e) {
          console.warn('[REPORT CACHE] Parse error:', e);
        }
      }

      // 2. Fetch fresh record from PostgreSQL backend
      if (interviewId) {
        try {
          const data = await api.getReport(interviewId);
          if (isMounted && data) {
            setReport(data);
            setIsLiveAiReport(true);
          }
        } catch (err) {
          console.warn('[REPORT FETCH] Could not fetch from backend:', err);
        }
      }

      if (isMounted) setLoading(false);
    }

    loadEvaluationReport();

    return () => {
      isMounted = false;
    };
  }, []);

  // -------------------------------------------------------------
  // BLOCK 3: Normalize Evaluation Metrics for Rendering
  // -------------------------------------------------------------
  // Formats both API responses and fallback mock structures uniformly
  const overallScore = report?.overall_score ?? report?.overallScore ?? fallbackMockData.overallScore;

  // Derive the 4 dimensional scores
  const scoreDimensions = report?.scores || [
    {
      label: 'Answer Quality',
      value: report?.answer_quality_score ?? fallbackMockData.scores[0].value,
    },
    {
      label: 'Communication',
      value: report?.communication_score ?? fallbackMockData.scores[1].value,
    },
    {
      label: 'Voice Confidence',
      value: report?.voice_confidence_score ?? fallbackMockData.scores[2].value,
    },
    {
      label: 'Camera Engagement',
      value: report?.camera_engagement_score ?? fallbackMockData.scores[3].value,
    },
  ];

  const strengthsList = report?.strengths || fallbackMockData.strengths;
  const improvementsList = report?.improvements || fallbackMockData.improvements;
  const feedbackText =
    report?.summary_feedback || report?.feedback || fallbackMockData.feedback;

  const targetRole =
    localStorage.getItem('target-role-title') || 'Software Engineer';
  const targetJd = localStorage.getItem('target-job-description') || '';

  // -------------------------------------------------------------
  // BLOCK 4: Render Loading State
  // -------------------------------------------------------------
  if (loading && !report) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
        <Loader2 className="h-10 w-10 animate-spin text-tealish-600" />
        <h2 className="mt-4 text-xl font-bold text-slate-800">Loading Evaluation Report</h2>
        <p className="mt-1 text-sm text-slate-500">Retrieving your scored interview metrics...</p>
      </div>
    );
  }

  // -------------------------------------------------------------
  // BLOCK 5: Render Full Evaluation Report Interface
  // -------------------------------------------------------------
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header & Navigation */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                isLiveAiReport
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {isLiveAiReport ? 'Official AI Evaluation Report' : 'Demonstration Report'}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              Role: {targetRole}
            </span>
            {targetJd && (
              <span className="inline-flex items-center gap-1 rounded-full bg-tealish-50 px-3 py-1 text-xs font-semibold text-tealish-700">
                <Sparkles className="h-3 w-3" /> Evaluated Against Custom JD
              </span>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
            Interview Performance Report
          </h1>
          <p className="mt-2 max-w-2xl text-slate-500">
            {isLiveAiReport
              ? `Results generated by Google Gemini RAG evaluation and computer vision metrics tailored for ${targetRole}.`
              : 'Frontend demonstration data only. Connect backend to view real evaluation.'}
          </p>
        </div>
        <button onClick={() => navigate('/dashboard')} className="secondary-btn">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>
      </section>

      {/* Top Scores Grid: Overall Score Card + 4 Breakdown Dimension Bars */}
      <section className="grid gap-6 lg:grid-cols-[330px_1fr]">
        {/* Overall Score Highlight Card */}
        <article className="rounded-2xl bg-navy-900 p-6 text-white shadow-card">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/10 p-2.5">
              <Trophy className="h-5 w-5 text-teal-200" />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">
              Overall Score
            </p>
          </div>
          <div className="mt-8 flex items-end gap-2">
            <span className="text-6xl font-bold tracking-tight">{overallScore}</span>
            <span className="pb-2 text-xl text-slate-400">/ 100</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            {overallScore >= 80
              ? 'Excellent performance demonstrating strong domain knowledge and composure.'
              : overallScore >= 65
              ? 'Solid performance with clear foundational understanding and potential for growth.'
              : 'Foundational attempt. Focus on addressing expected technical rubric points.'}
          </p>
          <div className="mt-8 rounded-xl bg-white/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-200">
              <Info className="h-4 w-4" />
              {isLiveAiReport ? 'Grounded AI Scoring' : 'Demo data notice'}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {isLiveAiReport
                ? 'Scores computed using Gemini 2.0 Flash, semantic vector similarity, and facial engagement tracking.'
                : 'These values come from src/data/mockData.js and are not produced from your recording.'}
            </p>
          </div>
        </article>

        {/* 4 Score Dimensions Breakdown */}
        <article className="card p-6 sm:p-7">
          <h2 className="text-lg font-bold text-slate-900">Evaluation Breakdown</h2>
          <p className="mt-1 text-sm text-slate-500">
            Weighted metrics across Answer Quality, Communication, Voice Confidence, and Camera Engagement.
          </p>
          <div className="mt-7 grid gap-6 sm:grid-cols-2">
            {scoreDimensions.map((score) => (
              <div key={score.label} className="rounded-xl border border-slate-200 p-4">
                <ProgressBar label={score.label} value={score.value} />
                <p className="mt-3 text-xs text-slate-400">
                  {isLiveAiReport ? 'Calculated via AI RAG & NLP' : 'Demo score'}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      {/* Two Column Section: Strengths & Areas to Improve */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Candidate Strengths */}
        <article className="card p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Key Strengths</h2>
          </div>
          <ul className="mt-5 space-y-3">
            {strengthsList.map((item, idx) => (
              <li
                key={idx}
                className="flex gap-3 rounded-xl bg-emerald-50/60 p-3 text-sm text-slate-700"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {item}
              </li>
            ))}
          </ul>
        </article>

        {/* Areas for Improvement */}
        <article className="card p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Areas for Improvement</h2>
          </div>
          <ul className="mt-5 space-y-3">
            {improvementsList.map((item, idx) => (
              <li
                key={idx}
                className="flex gap-3 rounded-xl bg-amber-50/60 p-3 text-sm text-slate-700"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                {item}
              </li>
            ))}
          </ul>
        </article>
      </section>

      {/* Bottom Card: Comprehensive AI Summary Feedback */}
      <section className="card p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-navy-50 p-3 text-navy-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tealish-600">
              {isLiveAiReport ? 'Grounded AI Evaluation' : 'AI Feedback · Demo'}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Summary Feedback</h2>
            <p className="mt-3 max-w-4xl leading-7 text-slate-600">{feedbackText}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
