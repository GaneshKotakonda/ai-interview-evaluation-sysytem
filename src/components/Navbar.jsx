import { Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandMark } from './ui';

// -------------------------------------------------------------
// Top bar: mobile menu button, a breadcrumb for the current page and the
// signed-in user's avatar (links to Profile).
// -------------------------------------------------------------

const sections = [
  ['/dashboard', 'Practice', 'Dashboard'],
  ['/readiness', 'Standard interview', 'Setup'],
  ['/interview-complete', 'Standard interview', 'Submitted'],
  ['/interview', 'Standard interview', 'In progress'],
  ['/report', 'Review', 'Report'],
  ['/arena/play', 'Interview Arena', 'Challenge'],
  ['/arena/results', 'Interview Arena', 'Results'],
  ['/arena', 'Practice', 'Interview Arena'],
  ['/interviews', 'Review', 'My Interviews'],
  ['/reports', 'Review', 'Reports'],
  ['/profile', 'Account', 'Profile'],
];

function crumbsFor(pathname) {
  const match = sections.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  return match ? [match[1], match[2]] : ['Workspace'];
}

export default function Navbar({ onOpenSidebar }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [section, page] = crumbsFor(pathname);
  const name = user?.displayName || user?.email || 'Candidate';

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-paper/85 px-4 backdrop-blur-md sm:px-6 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        <button aria-label="Open navigation" className="ghost-btn !p-2 lg:hidden" onClick={onOpenSidebar}>
          <Menu className="h-5 w-5" />
        </button>
        <span className="lg:hidden"><BrandMark className="h-7 w-7" /></span>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] sm:flex">
          <span className="text-ink-3">{section}</span>
          {page && (
            <>
              <span className="text-ink-4">/</span>
              <span className="truncate font-medium text-ink">{page}</span>
            </>
          )}
        </nav>
      </div>
      <Link
        to="/profile"
        aria-label="Open profile"
        className="flex items-center gap-2.5 rounded-full py-1 pl-3 pr-1 transition hover:bg-sunken"
      >
        <span className="hidden max-w-[200px] truncate text-[13px] text-ink-2 sm:block">{name}</span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ink font-serif text-base text-paper">
          {name.charAt(0).toUpperCase()}
        </span>
      </Link>
    </header>
  );
}
