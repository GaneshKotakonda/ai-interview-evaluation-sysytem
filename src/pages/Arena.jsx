import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Panel, SectionTitle } from '../components/ui';

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
const steps = [
  ['Answer', 'Five adaptive challenges, answered in text.'],
  ['Get scored', 'Each answer is evaluated against a rubric.'],
  ['Adapt', 'Strong answers raise the difficulty.'],
  ['Earn XP', 'Points for quality, difficulty and streaks.'],
  ['Boss Round', 'A final, harder question to finish.'],
];
const rules = [
  ['Base XP', 'Your answer score'],
  ['Difficulty bonus', 'Hard and expert levels'],
  ['Streak bonus', 'Consecutive strong answers'],
  ['Hint', '−20 XP on that turn'],
];

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
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        kicker="Game mode"
        title="Interview Arena"
        description="Quick, text-only practice. Climb through adaptive levels, keep a streak going and finish with a boss round."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel i={1} as="form" onSubmit={start} className="p-6 sm:p-8">
          <fieldset>
            <legend className="text-[15px] font-semibold text-ink">Choose your practice area</legend>
            <p className="mt-1 text-[13px] text-ink-3">Five adaptive challenges and a final Boss Round.</p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {areas.map((item, index) => {
                const active = selected === index;
                return (
                  <label
                    key={item.label}
                    className={`group relative flex cursor-pointer items-center gap-3 rounded-control border px-4 py-3.5 text-sm transition duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 ${
                      active ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink hover:border-ink-4'
                    }`}
                  >
                    <input
                      type="radio"
                      name="practice-area"
                      value={item.label}
                      checked={active}
                      onChange={() => setSelected(index)}
                      className="sr-only"
                    />
                    <span aria-hidden="true" className={`num font-mono text-xs ${active ? 'text-paper/50' : 'text-ink-4'}`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {item.label}
                    <span aria-hidden="true" className={`ml-auto grid h-5 w-5 place-items-center rounded-full transition ${active ? 'scale-100 bg-paper text-ink' : 'scale-75 opacity-0'}`}>
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {custom && (
            <div className="fade-in mt-6">
              <label htmlFor="custom-topic" className="field-label">Custom topic</label>
              <input id="custom-topic" required maxLength={160} value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} placeholder="e.g. React performance optimisation" className="input-field" />
            </div>
          )}
          <div className="mt-6">
            <label htmlFor="arena-description" className="field-label">Description (optional)</label>
            <textarea id="arena-description" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Anything you want the challenges to focus on?" className="input-field" />
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <p className="text-[13px] text-ink-3">You start with one hint.</p>
            <button type="submit" disabled={!topic} className="primary-btn">
              Start Arena Challenge <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel i={2} as="aside" className="p-6">
            <SectionTitle title="How Arena Works" />
            <ol className="relative mt-5 space-y-5 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-line">
              {steps.map(([title, text], index) => (
                <li key={title} className="reveal relative flex gap-4" style={{ '--i': index + 3 }}>
                  <span aria-hidden="true" className={`num relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] ${
                    index === steps.length - 1 ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface text-ink-2'
                  }`}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">{title}</p>
                    <p className="mt-0.5 text-[13px] text-ink-3">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel i={3} className="p-6">
            <SectionTitle title="Scoring" />
            <dl className="mt-3 divide-y divide-line text-[13px]">
              {rules.map(([term, detail]) => (
                <div key={term} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink">{term}</dt>
                  <dd className="text-right text-ink-3">{detail}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
