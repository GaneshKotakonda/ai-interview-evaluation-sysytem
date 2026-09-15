export default function ProgressBar({ label, value, compact = false }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-slate-700`}>{label}</span>
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-navy-800`}>{value}%</span>
      </div>
      <div className={`${compact ? 'h-1.5' : 'h-2'} overflow-hidden rounded-full bg-slate-100`}>
        <div
          className="h-full rounded-full bg-tealish-500 transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
          aria-label={`${label}: ${value}%`}
        />
      </div>
    </div>
  );
}
