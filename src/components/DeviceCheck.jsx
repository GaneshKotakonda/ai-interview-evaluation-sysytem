import { Check } from 'lucide-react';

// -------------------------------------------------------------
// One readiness row (camera, microphone, network…). A ready row shows an
// animated check; a waiting row shows its status in amber.
// -------------------------------------------------------------

export default function DeviceCheck({ icon: Icon, label, status, ready, helper }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="h-[18px] w-[18px] shrink-0 text-ink-3" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-3">{helper}</p>
      </div>
      <span className={`flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${ready ? 'text-ok' : 'text-warn'}`}>
        {ready ? (
          <span key="ready" className="scale-in grid h-5 w-5 place-items-center rounded-full bg-ok text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-warn/70" />
        )}
        {status}
      </span>
    </div>
  );
}
