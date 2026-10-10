import {
  FileText,
  Gamepad2,
  History,
  LayoutGrid,
  LogOut,
  Mic,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { clearInterviewProgress } from '../utils/interviewJourney';
import { Brand } from './ui';

// Navigation, grouped by what the candidate is doing.
const groups = [
  {
    title: 'Practice',
    items: [
      { label: 'Dashboard', icon: LayoutGrid, to: '/dashboard' },
      { label: 'Start Interview', icon: Mic, to: '/readiness' },
      { label: 'Interview Arena', icon: Gamepad2, to: '/arena' },
      { label: 'Leaderboard', icon: Trophy, to: '/arena/leaderboard' },
    ],
  },
  {
    title: 'Review',
    items: [
      { label: 'My Interviews', icon: History, to: '/interviews' },
      { label: 'Reports', icon: FileText, to: '/reports' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Profile', icon: UserRound, to: '/profile' }],
  },
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
          className="fade-in fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-line bg-paper transition-transform duration-300 ease-out lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Brand />
          <button aria-label="Close navigation" className="ghost-btn !p-2 lg:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="px-3 pb-1.5 text-[11px] font-medium text-ink-4">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map(({ label, icon: Icon, to }) => (
                  <li key={label}>
                    <NavLink
                      to={to}
                      onClick={() => {
                        // Starting fresh must not show the previous interview's turns.
                        if (label === 'Start Interview') clearInterviewProgress();
                        onClose();
                      }}
                      className={({ isActive }) =>
                        `group flex items-center gap-3 rounded-control border px-3 py-2 text-[14px] transition duration-200 ${
                          isActive
                            ? 'border-line bg-surface font-medium text-ink shadow-panel'
                            : 'border-transparent text-ink-2 hover:bg-sunken/70 hover:text-ink'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={`h-[18px] w-[18px] transition ${isActive ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2'}`}
                            strokeWidth={1.75}
                          />
                          {label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <NavLink
            to="/profile"
            onClick={onClose}
            className="flex items-center gap-3 rounded-control px-2.5 py-2 transition hover:bg-sunken/70"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink font-serif text-lg text-paper">
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">{displayName}</span>
              <span className="block truncate text-xs text-ink-3">{user?.email}</span>
            </span>
          </NavLink>
          <button
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-control px-3 py-2 text-[13px] text-ink-3 transition hover:bg-bad-soft hover:text-bad"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
