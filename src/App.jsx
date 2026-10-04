import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import Readiness from './pages/Readiness';
import Interview from './pages/Interview';
import InterviewComplete from './pages/InterviewComplete';
import Report from './pages/Report';
import Arena from './pages/Arena';
import ArenaPlay from './pages/ArenaPlay';
import ArenaResults from './pages/ArenaResults';
import MyInterviews from './pages/MyInterviews';
import Reports from './pages/Reports';
import Profile from './pages/Profile';

// -------------------------------------------------------------
// Route table.
// Public: /login, /signup, /forgot-password.
// Protected (signed-in users, inside the sidebar layout): dashboard,
// Standard interview flow (readiness → interview → complete → report) and
// Arena flow (setup → play → results), My Interviews, Reports and Profile.
// Unknown paths go to the dashboard.
// -------------------------------------------------------------

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/readiness" element={<Readiness />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/interview-complete" element={<InterviewComplete />} />
          <Route path="/arena" element={<Arena />} />
          <Route path="/arena/results" element={<ArenaResults />} />
          <Route path="/arena/play" element={<ArenaPlay />} />
          <Route path="/report" element={<Report />} />
          <Route path="/interviews" element={<MyInterviews />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
