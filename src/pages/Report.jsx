import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Sparkles, Trophy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ProgressBar from '../components/ProgressBar';
import { reportData } from '../data/mockData';

export default function Report() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Demo Evaluation Report</span></div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Interview Performance Report</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Frontend demonstration data only. No actual AI analysis has been performed.</p>
        </div>
        <button onClick={() => navigate('/dashboard')} className="secondary-btn"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</button>
      </section>

      <section className="grid gap-6 lg:grid-cols-[330px_1fr]">
        <article className="rounded-2xl bg-navy-900 p-6 text-white shadow-card">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-white/10 p-2.5"><Trophy className="h-5 w-5 text-teal-200" /></div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Overall Score</p></div>
          <div className="mt-8 flex items-end gap-2"><span className="text-6xl font-bold tracking-tight">{reportData.overallScore}</span><span className="pb-2 text-xl text-slate-400">/ 100</span></div>
          <p className="mt-4 text-sm leading-6 text-slate-300">A solid prototype score indicating balanced performance across the four demonstration dimensions.</p>
          <div className="mt-8 rounded-xl bg-white/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-teal-200"><Info className="h-4 w-4" />Demo data notice</div><p className="mt-2 text-xs leading-5 text-slate-400">These values come from src/data/mockData.js and are not produced from your recording.</p></div>
        </article>

        <article className="card p-6 sm:p-7">
          <h2 className="text-lg font-bold text-slate-900">Evaluation Breakdown</h2>
          <p className="mt-1 text-sm text-slate-500">Four score dimensions prepared for future backend/API integration.</p>
          <div className="mt-7 grid gap-6 sm:grid-cols-2">
            {reportData.scores.map((score) => <div key={score.label} className="rounded-xl border border-slate-200 p-4"><ProgressBar {...score} /><p className="mt-3 text-xs text-slate-400">Demo score</p></div>)}
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="card p-6">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></div><h2 className="text-lg font-bold text-slate-900">Strengths</h2></div>
          <ul className="mt-5 space-y-3">{reportData.strengths.map((item) => <li key={item} className="flex gap-3 rounded-xl bg-emerald-50/60 p-3 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{item}</li>)}</ul>
        </article>
        <article className="card p-6">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-amber-50 p-2.5 text-amber-600"><AlertTriangle className="h-5 w-5" /></div><h2 className="text-lg font-bold text-slate-900">Areas to Improve</h2></div>
          <ul className="mt-5 space-y-3">{reportData.improvements.map((item) => <li key={item} className="flex gap-3 rounded-xl bg-amber-50/60 p-3 text-sm text-slate-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{item}</li>)}</ul>
        </article>
      </section>

      <section className="card p-6 sm:p-7">
        <div className="flex items-start gap-4"><div className="rounded-xl bg-navy-50 p-3 text-navy-700"><Sparkles className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-tealish-600">AI Feedback · Demo</p><h2 className="mt-1 text-lg font-bold text-slate-900">Summary Feedback</h2><p className="mt-3 max-w-4xl leading-7 text-slate-600">{reportData.feedback}</p></div></div>
      </section>
    </div>
  );
}
