import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, LoaderCircle } from 'lucide-react';

// -------------------------------------------------------------
// Shared presentational building blocks. Pages compose these so spacing,
// type and motion stay consistent everywhere.
// -------------------------------------------------------------

// Brand mark: a rounded ink tile with a four-bar voice waveform.
export function BrandMark({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#171611" />
      {[[9, 13, 6], [13.5, 9, 14], [18, 11, 10], [22.5, 14, 4]].map(([x, y, h]) => (
        <rect key={x} x={x - 1.25} y={y} width="2.5" height={h} rx="1.25" fill="#f7f6f2" />
      ))}
    </svg>
  );
}

export function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {!compact && (
        <div className="leading-tight">
          <p className="text-[13px] font-semibold tracking-tight text-ink">AI Interview</p>
          <p className="text-[12px] text-ink-3">Evaluation System</p>
        </div>
      )}
    </div>
  );
}

// Page title row. Titles use the display serif; actions sit on the right.
export function PageHeader({ kicker, title, description, actions }) {
  return (
    <header className="reveal flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {kicker && <p className="text-[13px] text-ink-3">{kicker}</p>}
        <h1 className="mt-1 font-serif text-[2.25rem] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.6rem]">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

// Section heading used inside panels.
export function SectionTitle({ title, description, action, as: Tag = 'h2' }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Tag className="text-[15px] font-semibold tracking-tight text-ink">{title}</Tag>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Panel({ className = '', children, i, as: Tag = 'section', ...props }) {
  return (
    <Tag className={`card reveal ${className}`} style={i !== undefined ? { '--i': i } : undefined} {...props}>
      {children}
    </Tag>
  );
}

const toneStyles = {
  neutral: 'bg-sunken text-ink-2',
  ink: 'bg-ink text-paper',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneStyles[tone]} ${className}`}>
      {children}
    </span>
  );
}

// Inline message. `tone` decides icon and colour; role defaults to
// alert for errors and status otherwise.
export function Notice({ tone = 'neutral', children, role, className = '', action }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'neutral' ? Info : AlertCircle;
  const styles = {
    neutral: 'border-line bg-paper text-ink-2',
    ok: 'border-ok/20 bg-ok-soft text-ok',
    warn: 'border-warn/20 bg-warn-soft text-warn',
    bad: 'border-bad/20 bg-bad-soft text-bad',
  }[tone];
  return (
    <div role={role ?? (tone === 'bad' ? 'alert' : 'status')} className={`fade-in flex items-start gap-3 rounded-control border px-3.5 py-3 text-sm ${styles} ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {action}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <LoaderCircle className={`${className} animate-spin`} aria-hidden="true" />;
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden="true" />;
}

// Centered loading block with a calm line of copy.
export function LoadingBlock({ label, className = 'py-16' }) {
  return (
    <div className={`fade-in flex items-center justify-center gap-3 text-sm text-ink-3 ${className}`}>
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action, headingLevel = 'h2' }) {
  const Heading = headingLevel;
  return (
    <div className="fade-in px-6 py-14 text-center">
      {Icon && (
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-dashed border-line-strong text-ink-3">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <Heading className="mt-4 font-serif text-2xl text-ink">{title}</Heading>
      {children && <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-3">{children}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

// Animated number. Counts up once on mount; renders the final value
// immediately where animation is unavailable or reduced motion is set.
export function CountUp({ value, suffix = '', duration = 900 }) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const canAnimate = numeric
    && typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && typeof window.requestAnimationFrame === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(canAnimate ? 0 : value);
  const frame = useRef(null);

  useEffect(() => {
    if (!canAnimate) {
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(value * eased));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, canAnimate, duration]);

  if (!numeric) return <>{value}</>;
  return <>{shown}{suffix}</>;
}

// One figure inside a StatRow: large number, small label underneath.
export function Stat({ label, value, hint, suffix = '' }) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  return (
    <div data-stat={label} className="min-w-0 px-5 py-5 sm:px-6">
      <p data-stat-value className="num font-serif text-[2.2rem] tracking-[-0.02em] leading-none text-ink">
        {numeric ? <CountUp value={value} suffix={suffix} /> : value}
      </p>
      <p className="mt-3 text-[13px] font-medium text-ink-2">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

// A row of stats sharing one panel. gap-px over a line-coloured background
// draws the hairlines between cells at every breakpoint.
export function StatRow({ children, className = '', i }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <Panel i={i} className={`grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4 ${className}`}>
      {items.map((child, index) => <div key={index} className="min-w-0 bg-surface">{child}</div>)}
    </Panel>
  );
}

// Segmented control (radio group) used for filters.
export function Segmented({ label, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-control border border-line bg-sunken p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition duration-200 ${
              active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(23,22,17,0.12)]' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Thin score bar coloured by band, used inline in tables and lists.
export function ScoreBar({ value, className = 'w-20' }) {
  if (value === null || value === undefined) return null;
  return (
    <span className={`relative inline-block h-1 overflow-hidden rounded-full bg-sunken ${className}`} aria-hidden="true">
      <span className="grow-x absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </span>
  );
}

// Three-step indicator for the Standard interview flow.
const FLOW = ['Setup', 'Interview', 'Report'];

export function FlowSteps({ current }) {
  return (
    <ol aria-label="Interview steps" className="reveal flex items-center gap-2 text-[13px]">
      {FLOW.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return (
          <li key={step} className="flex items-center gap-2" aria-current={state === 'active' ? 'step' : undefined}>
            {index > 0 && <span className={`h-px w-6 sm:w-10 ${index <= current ? 'bg-ink' : 'bg-line-strong'}`} />}
            <span
              className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${
                state === 'todo' ? 'border-line-strong text-ink-4' : 'border-ink bg-ink text-paper'
              }`}
            >
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span className={state === 'todo' ? 'text-ink-4' : 'text-ink'}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
