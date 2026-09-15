import {
  ArrowRight,
  Award,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  Gauge,
  ListChecks,
  Target,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import { dashboardStats, performanceOverview, recentInterviews } from '../data/mockData';

const statIcons = [ListChecks, Gauge, Award, Flame];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = (user?.displayName || 'Candidate').split(' ')[0];

  const startNewInterview = () => {
    localStorage.removeItem('ai-interview-progress');
    localStorage.removeItem('ai-interview-duration');
    navigate('/readiness');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-tealish-600">Candidate Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Welcome back, {firstName}</h1>
          <p className="mt-2 text-slate-500">Ready to improve your next interview?</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <CalendarDays className="h-4 w-4 text-navy-700" />
          <span>Practice plan active</span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat, index) => <StatCard key={stat.label} {...stat} icon={statIcons[index]} />)}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <article className="overflow-hidden rounded-2xl bg-navy-900 text-white shadow-card">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">Next Interview</span>
              <h2 className="mt-5 text-3xl font-bold">Software Engineer</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">A focused mock interview covering introduction, projects, operating-system fundamentals, performance thinking, and role fit.</p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/5 p-3">
                  <ListChecks className="h-4 w-4 text-teal-300" />
                  <p className="mt-2 text-xs text-slate-400">Questions</p>
                  <p className="mt-1 font-semibold">5 Questions</p>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <Clock3 className="h-4 w-4 text-teal-300" />
                  <p className="mt-2 text-xs text-slate-400">Estimated Duration</p>
                  <p className="mt-1 font-semibold">10 Minutes</p>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <Target className="h-4 w-4 text-teal-300" />
                  <p className="mt-2 text-xs text-slate-400">Difficulty</p>
                  <p className="mt-1 font-semibold">Intermediate</p>
                </div>
              </div>
            </div>
            <button onClick={startNewInterview} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-navy-900 transition hover:bg-slate-100">
              Start Interview <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </article>

        <article className="card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Performance Overview</h2>
              <p className="mt-1 text-xs text-slate-500">Demo metrics from previous sessions</p>
            </div>
            <div className="rounded-xl bg-tealish-50 p-2.5 text-tealish-600"><Gauge className="h-5 w-5" /></div>
          </div>
          <div className="mt-6 space-y-5">
            {performanceOverview.map((item) => <ProgressBar key={item.label} {...item} />)}
          </div>
        </article>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="text-lg font-bold text-slate-900">Recent Interviews</h2>
          <p className="mt-1 text-sm text-slate-500">Mock history shown for prototype demonstration.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Interview</th>
                <th className="px-6 py-3 font-semibold">Date</th>
                <th className="px-6 py-3 font-semibold">Score</th>
                <th className="px-6 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentInterviews.map((item) => (
                <tr key={`${item.role}-${item.date}`} className="hover:bg-slate-50/70">
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900">{item.role}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.date}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-navy-800">{item.score}%</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-tealish-500" style={{ width: `${item.score}%` }} /></div>
                    </div>
                  </td>
                  <td className="px-6 py-4"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{item.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
