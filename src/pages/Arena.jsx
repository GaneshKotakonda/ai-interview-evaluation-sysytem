import { useState } from 'react';
import { ArrowRight, Gamepad2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// -------------------------------------------------------------
// Arena setup: choose a practice area (or a custom topic) and start.
// The choice is passed to /arena/play through router state, so refreshing
// the play page returns here instead of silently starting a new game.
// -------------------------------------------------------------

const areas = [
  { label: 'Software Engineer', role_title: 'Software Engineer', topic: 'Software Engineering' },
  { label: 'Frontend / React', role_title: 'Frontend Developer', topic: 'React' },
  { label: 'Backend / Python', role_title: 'Backend Developer', topic: 'Python' },
  { label: 'Java', role_title: 'Java Developer', topic: 'Java' },
  { label: 'SQL / Database', role_title: 'Database Developer', topic: 'SQL / Database' },
  { label: 'Data Structures & Algorithms', role_title: 'Software Engineer', topic: 'Data Structures & Algorithms' },
  { label: 'Custom Topic', role_title: 'Software Engineer', topic: '' },
];
const steps = ['Answer Questions', 'AI Evaluates Your Answer', 'Difficulty Adapts', 'Earn XP', 'Build Streaks', 'Reach the Boss Round'];

export default function Arena() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(0);
  const [customTopic, setCustomTopic] = useState('');
  const [description, setDescription] = useState('');
  const area = areas[selected];
  const custom = area.label === 'Custom Topic';
  const topic = custom ? customTopic.trim() : area.topic;

  function start(event) {
    event.preventDefault();
    if (!topic) return;
    navigate('/arena/play', { state: { arenaConfig: {
      role_title: area.role_title,
      topic,
      custom_description: description.trim(),
      job_description: `Practice ${topic} interview questions.${description.trim() ? ` ${description.trim()}` : ''}`,
      interview_mode: 'game',
    } } });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-2xl bg-navy-900 p-6 text-white shadow-card sm:p-8">
        <Gamepad2 aria-hidden="true" className="h-8 w-8 text-teal-200" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-teal-200">Practice at your pace</p>
        <h1 className="mt-2 text-3xl font-bold">Interview Arena</h1>
        <p className="mt-3 text-slate-300">Practice technical interviews through adaptive AI challenges.</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={start} className="card p-6 sm:p-8">
          <fieldset>
            <legend className="text-xl font-bold text-slate-900">Choose your practice area</legend>
            <p className="mb-5 mt-2 text-sm text-slate-500">Five adaptive challenges and a final Boss Round. Text answers only.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {areas.map((item, index) => (
                <label key={item.label} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm font-semibold ${selected === index ? 'border-tealish-600 bg-tealish-50 text-navy-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  <input type="radio" name="practice-area" value={item.label} checked={selected === index} onChange={() => setSelected(index)} className="h-4 w-4 accent-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600" />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          {custom && <div className="mt-5">
            <label htmlFor="custom-topic" className="text-sm font-semibold text-slate-700">Custom topic</label>
            <input id="custom-topic" required maxLength={160} value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} placeholder="React Performance Optimization" className="input-field mt-2" />
          </div>}
          <div className="mt-5">
            <label htmlFor="arena-description" className="text-sm font-semibold text-slate-700">Description (optional)</label>
            <textarea id="arena-description" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What would you like to focus on?" className="input-field mt-2" />
          </div>
          <p className="my-5 text-sm text-slate-500">Start with one hint. Earn XP for your answers, difficulty and strong-answer streaks.</p>
          <button type="submit" disabled={!topic} className="primary-btn">Start Arena Challenge <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
        </form>
        <aside className="card self-start p-6 sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">How Arena Works</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Answer, review your feedback and choose when to continue. Difficulty adapts to your performance.</p>
          <ol className="mt-6 space-y-4">
            {steps.map((step, index) => <li key={step} className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tealish-50 text-tealish-700">{index + 1}</span>{step}
            </li>)}
          </ol>
        </aside>
      </div>
    </div>
  );
}
