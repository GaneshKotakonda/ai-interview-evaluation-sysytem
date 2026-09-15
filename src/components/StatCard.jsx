export default function StatCard({ icon: Icon, label, value, trend }) {
  return (
    <article className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{trend}</p>
        </div>
        <div className="rounded-xl bg-navy-50 p-2.5 text-navy-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}
