import {
  BarChart3,
  FileText,
  LayoutDashboard,
  LogOut,
  Mic,
  UserRound,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const items = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard', enabled: true },
  { label: 'Start Interview', icon: Mic, to: '/readiness', enabled: true },
  { label: 'My Interviews', icon: BarChart3, enabled: false },
  { label: 'Reports', icon: FileText, enabled: false },
  { label: 'Profile', icon: UserRound, enabled: false },
];

export default function Sidebar({ mobileOpen, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.displayName || 'Candidate';
  const initial = displayName.charAt(0).toUpperCase();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-slate-100 px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy-900 text-white shadow-sm">
              <Mic className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-navy-900">AI Interview</p>
              <p className="text-xs text-slate-500">Evaluation System</p>
            </div>
          </div>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-4">
          {items.map(({ label, icon: Icon, to, enabled }) =>
            enabled ? (
              <NavLink
                key={label}
                to={to}
                onClick={() => {
                  if (label === 'Start Interview') {
                    localStorage.removeItem('ai-interview-progress');
                    localStorage.removeItem('ai-interview-duration');
                  }
                  onClose();
                }}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${
                    isActive
                      ? 'bg-navy-50 text-navy-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="h-5 w-5" />
                {label}
              </NavLink>
            ) : (
              <button
                key={label}
                disabled
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-400"
                title="Planned for a future prototype phase"
              >
                <Icon className="h-5 w-5" />
                {label}
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                  Soon
                </span>
              </button>
            ),
          )}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy-900 text-sm font-bold text-white">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-700">
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
