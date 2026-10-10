import { useEffect, useState } from 'react';
import {
  ArrowRight, Check, Medal, Trophy,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, Panel, SectionTitle } from '../components/ui';
import { api } from '../services/api';

// -------------------------------------------------------------
// Arena setup: choose a practice area (or a custom topic) and start.
// The choice is passed to /arena/play through router state, so refreshing
// the play page returns here instead of silently starting a new game.
// Each area is a ranking category; coding areas include VPL challenges.
// -------------------------------------------------------------

const areas = [
  { label: 'Software Engineer', role_title: 'Software Engineer', topic: 'Software Engineering', category: 'software', coding: true },
  { label: 'Frontend / React', role_title: 'Frontend Developer', topic: 'React', category: 'frontend', coding: true },
  { label: 'Backend / Python', role_title: 'Backend Developer', topic: 'Python', category: 'backend', coding: true },
  { label: 'Java', role_title: 'Java Developer', topic: 'Java', category: 'java', coding: true },
  { label: 'SQL / Database', role_title: 'Database Developer', topic: 'SQL / Database', category: 'database', coding: false },
  { label: 'Data Structures & Algorithms', role_title: 'Software Engineer', topic: 'Data Structures & Algorithms', category: 'dsa', coding: true },
  { label: 'Custom Topic', role_title: 'Software Engineer', topic: '', category: 'general', coding: false },
];

// What the Arena is for.
export const ARENA_USES = [
  ['Ranked practice', 'A LeetCode-style rating shows where you stand among every other student, overall and per category.'],
  ['Category ranks', 'Separate ranks for Frontend, Backend, Java, SQL, DSA and more show which area to work on.'],
  ['Interview readiness', 'Adaptive levels get harder as you improve, ending with a Boss Round, like a real technical round.'],
  ['Coding practice', 'Coding areas include problems with hidden test cases in the built-in code editor (VPL).'],
  ['Exam conditions', 'Proctored like the interview: alone, no AI, no other tabs. Breaking the rules costs rating points.'],
  ['Track progress', 'Every session moves your rating, so improvement over weeks is visible on the leaderboard.'],
  ['Placement preparation', 'Teachers and placement cells can use the leaderboard to spot strong students and those who need help.'],
];

const rules = [
  ['Base XP', 'Your answer score'],
  ['Difficulty bonus', 'Hard and expert levels'],
  ['Streak bonus', 'Consecutive strong answers'],
  ['Hint', '−20 XP on that turn'],
  ['Rating', 'Score vs. difficulty, like LeetCode'],
  ['Warnings', '−15 rating each; leaving ends the game (−50)'],
];

function MyRanks() {
  const [ranking, setRanking] = useState(null);
  useEffect(() => {
    let active = true;
    api.getMyRanking?.().then((data) => { if (active) setRanking(data); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const overall = ranking?.ratings?.find((r) => r.category === 'overall');
  return (
    <Panel i={2} className="p-6">
      <SectionTitle
        title="Your ranking"
        action={<Link to="/arena/leaderboard" className="text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">Leaderboard</Link>}
      />
      {overall ? (
        <>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="num font-serif text-5xl leading-none text-ink">{overall.rating}</span>
            <span className="text-[13px] text-ink-3">rank #{overall.rank} of {overall.total}</span>
          </p>
          <ul className="mt-4 divide-y divide-line text-[13px]">
            {ranking.ratings.filter((r) => r.category !== 'overall').map((r) => (
              <li key={r.category} className="flex justify-between gap-3 py-2">
                <span className="text-ink-2">{r.label}</span>
                <span className="num font-mono text-ink">{r.rating} · #{r.rank}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">Play a ranked Arena to get your rating. Everyone starts at 1500.</p>
      )}
    </Panel>
  );
}

export default function Arena() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(0);
  const [customTopic, setCustomTopic] = useState('');
  const [description, setDescription] = useState('');
  const [coding, setCoding] = useState(areas[0].coding);
  const area = areas[selected];
  const custom = area.label === 'Custom Topic';
  const topic = custom ? customTopic.trim() : area.topic;

  function choose(index) {
    setSelected(index);
    setCoding(areas[index].coding);
  }

  function start(event) {
    event.preventDefault();
    if (!topic) return;
    navigate('/arena/play', { state: { arenaConfig: {
      role_title: area.role_title,
      topic,
      category: area.category,
      coding,
      custom_description: description.trim(),
      job_description: `Practice ${topic} interview questions.${description.trim() ? ` ${description.trim()}` : ''}`,
      interview_mode: 'game',
    } } });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        kicker="Ranked game mode"
        title="Interview Arena"
        description="Climb adaptive levels, keep a streak going, beat the Boss Round, and earn a rating that ranks you among every student, overall and by category."
        actions={<Link to="/arena/leaderboard" className="secondary-btn"><Trophy className="h-4 w-4" /> Leaderboard</Link>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel i={1} as="form" onSubmit={start} className="p-6 sm:p-8">
          <fieldset>
            <legend className="text-[15px] font-semibold text-ink">Choose your practice area</legend>
            <p className="mt-1 text-[13px] text-ink-3">Each area is a ranking category. Five adaptive levels and a final Boss Round.</p>
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
                    <input type="radio" name="practice-area" value={item.label} checked={active} onChange={() => choose(index)} className="sr-only" />
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
          <label className="mt-5 flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-1" checked={coding} onChange={(event) => setCoding(event.target.checked)} />
            <span>
              Include coding challenges
              <span className="block text-[13px] text-ink-3">Levels 3 and 5 open the code editor (VPL) with hidden test cases.</span>
            </span>
          </label>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <p className="text-[13px] text-ink-3">Proctored and ranked · camera required · one hint.</p>
            <button type="submit" disabled={!topic} className="primary-btn">
              Start Arena Challenge <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </Panel>

        <div className="space-y-5">
          <MyRanks />
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

      <Panel i={4} className="p-6 sm:p-8">
        <SectionTitle title="What the Arena is for" description="Why practise in ranked game mode." />
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ARENA_USES.map(([title, text], index) => (
            <li key={title} className="reveal flex gap-3" style={{ '--i': index + 5 }}>
              <Medal aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
              <div>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
