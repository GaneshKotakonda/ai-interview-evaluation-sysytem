import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

// -------------------------------------------------------------
// Signed-in page frame: fixed sidebar (slide-over on mobile), top bar,
// and the routed page. Keying the page wrapper on the path replays the
// entrance animation on every navigation.
// -------------------------------------------------------------

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-paper">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-[260px]">
        <Navbar onOpenSidebar={() => setMobileOpen(true)} />
        <main key={pathname} className="page-enter px-4 pb-16 pt-8 sm:px-6 lg:px-10 lg:pt-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
