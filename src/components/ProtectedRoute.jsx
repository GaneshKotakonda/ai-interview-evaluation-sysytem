import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandMark, Spinner } from './ui';

// -------------------------------------------------------------
// Route guard: shows a loader while Firebase restores the session, then
// either renders the protected routes or redirects to /login, remembering
// the page the user asked for.
// -------------------------------------------------------------

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="fade-in flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
        <BrandMark className="h-10 w-10" />
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Spinner />
          Loading your workspace…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
