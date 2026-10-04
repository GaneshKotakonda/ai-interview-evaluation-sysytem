import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Award,
  Briefcase,
  CheckCircle2,
  Clock3,
  Gamepad2,
  Gauge,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  Save,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import { api } from '../services/api';
import { STORAGE_KEYS } from '../utils/interviewJourney';
import { formatDate, formatTotalTime } from '../utils/interviewFormat';

// -------------------------------------------------------------
// BLOCK 1: Helpers
// -------------------------------------------------------------
const MIN_PASSWORD_LENGTH = 6;

function passwordErrorMessage(error) {
  switch (error?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Your current password is incorrect.';
    case 'auth/weak-password':
      return `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`;
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/requires-recent-login':
      return 'Please sign out and sign in again before changing your password.';
    default:
      return 'Could not change your password. Please try again.';
  }
}

function Notice({ tone, children }) {
  const styles = tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${styles}`}>
      <Icon className="h-4 w-4 shrink-0" /> {children}
    </p>
  );
}

// -------------------------------------------------------------
// BLOCK 2: Account details (display name, default role)
// -------------------------------------------------------------
function AccountDetails({ user, onSaved }) {
  const { updateDisplayName } = useAuth();
  const [fullName, setFullName] = useState(user?.displayName || '');
  const [defaultRole, setDefaultRole] = useState(() => localStorage.getItem(STORAGE_KEYS.roleTitle) || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const name = fullName.trim();
    if (!name) {
      setNotice({ tone: 'error', text: 'Please enter your name.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      if (name !== user.displayName) await updateDisplayName(name);
      const role = defaultRole.trim();
      if (role) localStorage.setItem(STORAGE_KEYS.roleTitle, role);
      else localStorage.removeItem(STORAGE_KEYS.roleTitle);
      // Keep the backend copy in sync; Firebase stays the source of truth,
      // so a backend outage does not undo the change.
      try {
        onSaved(await api.updateProfile(user.uid, { fullName: name, email: user.email }));
        setNotice({ tone: 'success', text: 'Profile updated.' });
      } catch {
        setNotice({ tone: 'success', text: 'Profile updated. It will sync with your interview records next time you start an interview.' });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Could not update your profile. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 p-6">
      <div className="flex items-center gap-2">
        <UserRound className="h-5 w-5 text-navy-700" />
        <h2 className="text-lg font-bold text-slate-900">Account Details</h2>
      </div>
      <div>
        <label htmlFor="profile-name" className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
        <input id="profile-name" className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={255} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="profile-email" className="mb-2 block text-sm font-medium text-slate-700">Email</label>
        <input id="profile-email" className="input-field bg-slate-50 text-slate-500" value={user?.email || ''} readOnly />
      </div>
      <div>
        <label htmlFor="profile-role" className="mb-2 block text-sm font-medium text-slate-700">Default target role</label>
        <input
          id="profile-role"
          className="input-field"
          placeholder="e.g. Backend Engineer"
          value={defaultRole}
          onChange={(e) => setDefaultRole(e.target.value)}
          maxLength={100}
        />
        <p className="mt-1.5 text-xs text-slate-500">Pre-filled on the interview setup page in this browser.</p>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <button type="submit" className="primary-btn" disabled={saving}>
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save changes
      </button>
    </form>
  );
}

// -------------------------------------------------------------
// BLOCK 3: Change password
// -------------------------------------------------------------
function ChangePassword() {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setNotice({ tone: 'error', text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    if (next !== confirm) {
      setNotice({ tone: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (next === current) {
      setNotice({ tone: 'error', text: 'New password must be different from the current one.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice({ tone: 'success', text: 'Password changed.' });
    } catch (error) {
      setNotice({ tone: 'error', text: passwordErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-navy-700" />
        <h2 className="text-lg font-bold text-slate-900">Change Password</h2>
      </div>
      <div>
        <label htmlFor="current-password" className="mb-2 block text-sm font-medium text-slate-700">Current password</label>
        <input id="current-password" type="password" className="input-field" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-700">New password</label>
          <input id="new-password" type="password" className="input-field" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
        </div>
        <div>
          <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-slate-700">Confirm new password</label>
          <input id="confirm-password" type="password" className="input-field" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <button type="submit" className="secondary-btn" disabled={saving}>
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Update password
      </button>
    </form>
  );
}

// -------------------------------------------------------------
// BLOCK 4: Page
// -------------------------------------------------------------
export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!user?.uid) {
      setLoading(false);
      return () => { active = false; };
    }
    api.getProfile(user.uid)
      .then((data) => { if (active) setProfile(data); })
      .catch(() => { if (active) setError('We could not load your practice statistics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.uid]);

  const displayName = user?.displayName || 'Candidate';
  const stats = profile?.stats;
  const statValue = (value, suffix = '') => (loading || error || value === null || value === undefined ? '—' : `${value}${suffix}`);
  const statCards = [
    { label: 'Total Interviews', value: statValue(stats?.total_interviews), trend: 'Standard and Arena', icon: ListChecks },
    { label: 'Completed', value: statValue(stats?.completed_interviews), trend: 'Finished sessions', icon: CheckCircle2 },
    { label: 'Average Score', value: statValue(stats?.average_score, '%'), trend: 'Across completed sessions', icon: Gauge },
    { label: 'Best Score', value: statValue(stats?.best_score, '%'), trend: 'Highest completed score', icon: Award },
    { label: 'Standard Interviews', value: statValue(stats?.standard_interviews), trend: 'Professional evaluations', icon: Briefcase },
    { label: 'Arena Sessions', value: statValue(stats?.arena_sessions), trend: 'Game-mode practice', icon: Gamepad2 },
    {
      label: 'Practice Time',
      value: loading || error ? '—' : formatTotalTime(stats?.total_practice_seconds),
      trend: 'Recorded interview time',
      icon: Clock3,
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-navy-900 text-2xl font-bold text-white">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{displayName}</h1>
            <p className="truncate text-sm text-slate-500">{user?.email}</p>
            <p className="mt-1 text-xs text-slate-400">
              Member since {formatDate(user?.metadata?.creationTime)}
              {stats?.last_interview_at && ` · Last interview ${formatDate(stats.last_interview_at)}`}
            </p>
          </div>
        </div>
        <button onClick={handleLogout} className="secondary-btn self-start hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 sm:self-auto">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      <section aria-label="Practice statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => <StatCard key={card.label} {...card} />)}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <AccountDetails user={user} onSaved={setProfile} />
        <ChangePassword />
      </section>
    </div>
  );
}
