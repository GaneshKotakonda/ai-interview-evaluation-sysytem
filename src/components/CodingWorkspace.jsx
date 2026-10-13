import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Clock, Code2, Loader2, Play, Send, Terminal, XCircle,
} from 'lucide-react';
import { Badge, Notice } from './ui';
import CodeEditor from './CodeEditor';
import { api } from '../services/api';

// -------------------------------------------------------------
// VPL workspace for one coding question
// -------------------------------------------------------------
// Left: the problem (statement, formats, constraints, worked examples).
// Right: language menu, editor, Run (the visible examples, plus optional
// custom input) and Submit (every test, hidden ones included, graded on
// the server). Drafts are kept per language in this browser, so a reload
// does not lose code. When the time runs out the code is submitted.
const STATUS = {
  passed: ['Passed', 'ok'],
  wrong_answer: ['Wrong answer', 'bad'],
  time_limit: ['Time limit exceeded', 'bad'],
  runtime_error: ['Runtime error', 'bad'],
  output_limit: ['Output too long', 'bad'],
  skipped: ['Skipped', 'neutral'],
  ran: ['Ran', 'neutral'],
};

let languagesPromise;
function loadLanguages() {
  languagesPromise ||= (api.getCodingLanguages?.() || Promise.resolve([]))
    .catch(() => { languagesPromise = null; return []; });
  return languagesPromise;
}

const draftKey = (interviewId, index, language) => `vpl-draft:${interviewId}:${index}:${language}`;

function readDraft(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function Block({ children }) {
  return <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-paper p-2.5 font-mono text-[12px] leading-relaxed text-ink">{children}</pre>;
}

export default function CodingWorkspace({ interviewId, question, onSubmit, submitting = false, signals, onInjected }) {
  const coding = question.coding;
  const [languages, setLanguages] = useState([{ id: 'python', label: 'Python 3' }]);
  const [language, setLanguage] = useState('python');
  const [codes, setCodes] = useState({});
  const [run, setRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const deadline = useMemo(() => Date.now() + (coding.minutes || 20) * 60 * 1000, [coding.minutes]);
  const [left, setLeft] = useState((coding.minutes || 20) * 60);
  const submittedRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadLanguages().then((list) => {
      if (active && Array.isArray(list) && list.length) setLanguages(list);
    });
    return () => { active = false; };
  }, []);

  const code = codes[language]
    ?? readDraft(draftKey(interviewId, question.index, language))
    ?? coding.starter_code?.[language] ?? '';

  const changeCode = (value) => {
    setCodes((current) => ({ ...current, [language]: value }));
    try {
      localStorage.setItem(draftKey(interviewId, question.index, language), value);
    } catch {
      // Drafts are a convenience only.
    }
  };

  const activity = ({ typed, inserted }) => {
    if (typed) signals?.typing.typed(typed);
    signals?.markActivity();
    if (inserted && signals?.typing.input({ isTrusted: true }, inserted)) onInjected?.(inserted);
  };

  const submit = () => {
    if (submittedRef.current || submitting) return;
    submittedRef.current = true;
    onSubmit({ language, code });
  };

  // Countdown; at zero the current code is submitted.
  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = (deadline - Date.now()) / 1000;
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        submit();
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, language, code]);

  async function runExamples() {
    setRunning(true);
    setRunError('');
    try {
      setRun(await api.runCode(interviewId, {
        questionIndex: question.index, language, code, customInput: useCustom ? customInput : null,
      }));
    } catch (error) {
      setRunError(error?.detail || 'The code could not be run. Try again in a moment.');
    } finally {
      setRunning(false);
    }
  }

  const passed = run?.results?.filter((r) => r.status === 'passed').length ?? 0;
  const exampleCount = run?.results?.filter((r) => !r.custom).length ?? 0;

  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      {/* Problem */}
      <article className="space-y-4 text-sm leading-relaxed text-ink-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ink"><Code2 className="h-3 w-3" /> Coding problem</Badge>
          <Badge>{coding.difficulty?.replace(/^./, (c) => c.toUpperCase())}</Badge>
          {(coding.tags || []).slice(0, 3).map((tag) => <span key={tag} className="text-xs text-ink-3">{tag}</span>)}
        </div>
        <h2 className="font-serif text-[1.6rem] leading-snug text-ink">{coding.title}</h2>
        <p>{coding.statement}</p>
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Input</h3>
          <p>{coding.input_format}</p>
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Output</h3>
          <p>{coding.output_format}</p>
        </div>
        {coding.constraints?.length > 0 && (
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Constraints</h3>
            <ul className="mt-1 list-disc pl-5 font-mono text-[12px]">{coding.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {(coding.examples || []).map((example, index) => (
          <div key={index}>
            <h3 className="text-[13px] font-semibold text-ink">Example {index + 1}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><span className="text-xs text-ink-3">Input</span><Block>{example.input}</Block></div>
              <div><span className="text-xs text-ink-3">Output</span><Block>{example.expected}</Block></div>
            </div>
            {example.explanation && <p className="mt-1 text-xs text-ink-3">{example.explanation}</p>}
          </div>
        ))}
        <p className="text-xs text-ink-3">
          Your submission also runs on {coding.hidden_tests} hidden tests, including edge cases and large inputs
          {coding.complexity ? ` (an efficient solution is about ${coding.complexity})` : ''}.
        </p>
      </article>

      {/* Editor */}
      <section className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface" aria-label="Code editor area">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <label className="flex items-center gap-2 text-xs text-ink-3">
            Language
            <select
              value={language}
              onChange={(event) => { setLanguage(event.target.value); setRun(null); }}
              className="rounded-control border border-line bg-paper px-2 py-1 text-[13px] text-ink"
              disabled={submitting}
            >
              {languages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <span className={`num flex items-center gap-1.5 font-mono text-[13px] ${left < 120 ? 'text-bad' : 'text-ink-2'}`} role="timer" aria-label="Time left">
            <Clock className="h-3.5 w-3.5" /> {clock(left)}
          </span>
        </div>
        <div className="min-h-[340px] flex-1">
          <CodeEditor value={code} language={language} onChange={changeCode} onActivity={activity} readOnly={submitting} />
        </div>
        <div className="space-y-3 border-t border-line p-3">
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={useCustom} onChange={(event) => setUseCustom(event.target.checked)} /> Also run my own input
          </label>
          {useCustom && (
            <textarea
              aria-label="Custom input"
              rows={3}
              value={customInput}
              onChange={(event) => setCustomInput(event.target.value)}
              className="input-field font-mono !text-[12px]"
              placeholder="Input exactly as the program reads it"
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-3">{run?.runs_left !== undefined ? `${run.runs_left} runs left` : 'Run checks the examples; Submit runs every test.'}</span>
            <div className="flex gap-2">
              <button type="button" className="secondary-btn !py-2" onClick={runExamples} disabled={running || submitting}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
              </button>
              <button type="button" className="primary-btn !py-2" onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit solution
              </button>
            </div>
          </div>
          {runError && <Notice tone="warn" role="alert">{runError}</Notice>}
          {run && (
            <div className="space-y-2" aria-live="polite">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <Terminal className="h-4 w-4" />
                {run.compiled ? `${passed} of ${exampleCount} examples passed` : 'Compilation failed'}
              </p>
              {!run.compiled && <Block>{run.compile_output}</Block>}
              {run.results?.map((result, index) => {
                const [label, tone] = STATUS[result.status] || [result.status, 'neutral'];
                return (
                  <details key={index} className="rounded-control border border-line p-2.5" open={result.status !== 'passed'}>
                    <summary className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
                      <span className="flex items-center gap-2">
                        {result.status === 'passed' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-bad" />}
                        {result.custom ? 'Your input' : `Example ${index + 1}`}
                      </span>
                      <span className="flex items-center gap-2"><Badge tone={tone}>{label}</Badge><span className="num font-mono text-xs text-ink-3">{result.time_ms} ms</span></span>
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div><span className="text-xs text-ink-3">Expected</span><Block>{result.expected ?? '(not available for custom input)'}</Block></div>
                      <div><span className="text-xs text-ink-3">Your output</span><Block>{result.stdout || ' '}</Block></div>
                    </div>
                    {result.stderr && <div className="mt-2"><span className="text-xs text-ink-3">Errors</span><Block>{result.stderr}</Block></div>}
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
