import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function DeviceCheck({ icon: Icon, label, status, ready, helper }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className={`rounded-xl p-2.5 ${ready ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{helper}</p>
      </div>
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${ready ? 'text-emerald-600' : 'text-amber-600'}`}>
        {ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        <span className="whitespace-nowrap">{status}</span>
      </div>
    </div>
  );
}
