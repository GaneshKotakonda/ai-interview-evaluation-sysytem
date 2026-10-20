// -------------------------------------------------------------
// Labelled percentage meter. The fill grows in on mount and is clamped to
// 0..100%. `i` staggers the animation when several meters are stacked.
// -------------------------------------------------------------

export default function ProgressBar({ label, value, compact = false, i = 0 }) {
  const missing = value === null || value === undefined;
  const width = missing ? 0 : Math.max(0, Math.min(value, 100));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className={`${compact ? 'text-xs' : 'text-[13px]'} font-medium text-ink-2`}>{label}</span>
        <span className={`num font-mono ${compact ? 'text-xs' : 'text-[13px]'} text-ink`}>{missing ? '—' : `${value}%`}</span>
      </div>
      <div className={`${compact ? 'h-1' : 'h-1.5'} overflow-hidden rounded-full bg-sunken`}>
        <div
          className="grow-x h-full rounded-full bg-ink"
          style={{ width: `${width}%`, '--i': i }}
          aria-label={missing ? `${label}: not available` : `${label}: ${value}%`}
        />
      </div>
    </div>
  );
}
