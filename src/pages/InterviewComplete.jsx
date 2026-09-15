import { Check, CheckCircle2, Clock3, LoaderCircle, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Approx. 10 minutes';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export default function InterviewComplete() {
  const navigate = useNavigate();
  const duration = Number(localStorage.getItem('ai-interview-duration'));
  const analysisItems = [
    { label: 'Speech Analysis', state: 'Completed', complete: true },
    { label: 'Answer Evaluation', state: 'Processing', complete: false },
    { label: 'Communication Analysis', state: 'Processing', complete: false },
    { label: 'Camera Engagement', state: 'Processing', complete: false },
  ];

  return (
    <div className="mx-auto max-w-4xl py-3 sm:py-8">
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 p-6 text-center sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-9 w-9" /></div>
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">Submission Complete</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Interview Completed!</h1>
          <p className="mx-auto mt-3 max-w-xl text-slate-500">Your responses have been successfully submitted.</p>

          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Questions Answered</p><p className="mt-1 text-lg font-bold text-slate-900">5 Questions</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><Clock3 className="mx-auto h-4 w-4 text-navy-700" /><p className="mt-2 text-xs text-slate-500">Approximate Duration</p><p className="mt-1 font-bold text-slate-900">{formatDuration(duration)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Submission Status</p><p className="mt-1 inline-flex items-center gap-1.5 font-bold text-emerald-700"><Check className="h-4 w-4" />Completed</p></div>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-navy-50 p-2.5 text-navy-700"><Sparkles className="h-5 w-5" /></div>
            <div><h2 className="font-bold text-slate-900">AI Analysis</h2><p className="text-sm text-slate-500">Demonstration status only — no real AI scoring is running.</p></div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {analysisItems.map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
                <div className={`grid h-9 w-9 place-items-center rounded-full ${item.complete ? 'bg-emerald-50 text-emerald-600' : 'bg-navy-50 text-navy-700'}`}>
                  {item.complete ? <Check className="h-4 w-4" /> : <LoaderCircle className="h-4 w-4 animate-spin" />}
                </div>
                <div><p className="text-sm font-semibold text-slate-800">{item.label}</p><p className={`text-xs ${item.complete ? 'text-emerald-600' : 'text-navy-600'}`}>{item.state}</p></div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-center"><button onClick={() => navigate('/report')} className="primary-btn">View Demo Report</button></div>
        </div>
      </section>
    </div>
  );
}
