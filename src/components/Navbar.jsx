import { Menu, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ onOpenSidebar }) {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          aria-label="Open navigation"
          className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
          onClick={onOpenSidebar}
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
          <ShieldCheck className="h-4 w-4 text-tealish-600" />
          Candidate Workspace
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">Signed in as</p>
        <p className="mt-1 max-w-[180px] truncate text-sm font-semibold text-slate-800">{user?.displayName || user?.email}</p>
      </div>
    </header>
  );
}
