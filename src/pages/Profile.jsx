import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Notice, Panel, Spinner, Stat, StatRow,
} from '../components/ui';
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

// Settings row: title and explanation on the left, the form on the right.
function SettingsSection({ title, description, children, i }) {
  return (
    <Panel i={i} className="grid gap-6 p-6 sm:p-8 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{description}</p>
      </div>
      <div>{children}</div>
    </Panel>
  );
}

// -------------------------------------------------------------
// BLOCK 2: Account details (display name, default role)
// -------------------------------------------------------------
function AccountDetails({ user, onSaved, i }) {
  const { updateDisplayName } = useAuth();
  const [fullName, setFullName] = useState(user?.displayName || '');
  const [defaultRole, setDefaultRole] = useState(() => localStorage.getItem(STORAGE_KEYS.roleTitle) || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const name = fullName.trim();
    if (!name) {
      setNotice({ tone: 'bad', text: 'Please enter your name.' });
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
        setNotice({ tone: 'ok', text: 'Profile updated.' });
      } catch {
        setNotice({ tone: 'ok', text: 'Profile updated. It will sync with your interview records next time you start an interview.' });
      }
    } catch {
      setNotice({ tone: 'bad', text: 'Could not update your profile. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection i={i} title="Account details" description="Your name appears on reports. Email is managed by your sign-in account.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="profile-name" className="field-label">Full name</label>
            <input id="profile-name" className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={255} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="profile-email" className="field-label">Email</label>
            <input id="profile-email" className="input-field" value={user?.email || ''} readOnly disabled />
          </div>
        </div>
        <div>
          <label htmlFor="profile-role" className="field-label">Default target role</label>
          <input
            id="profile-role"
            className="input-field"
            placeholder="e.g. Backend Engineer"
            value={defaultRole}
            onChange={(e) => setDefaultRole(e.target.value)}
            maxLength={100}
          />
          <p className="mt-1.5 text-xs text-ink-3">Pre-filled on the interview setup page in this browser.</p>
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <div className="flex justify-end">
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving && <Spinner />}
            Save changes
          </button>
        </div>
      </form>
    </SettingsSection>
  );
}

// -------------------------------------------------------------
// BLOCK 3: Change password
// -------------------------------------------------------------
function ChangePassword({ i }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setNotice({ tone: 'bad', text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    if (next !== confirm) {
      setNotice({ tone: 'bad', text: 'New passwords do not match.' });
      return;
    }
    if (next === current) {
      setNotice({ tone: 'bad', text: 'New password must be different from the current one.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice({ tone: 'ok', text: 'Password changed.' });
    } catch (error) {
      setNotice({ tone: 'bad', text: passwordErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection i={i} title="Password" description="Confirm your current password before choosing a new one.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="sm:max-w-[calc(50%-10px)]">
          <label htmlFor="current-password" className="field-label">Current password</label>
          <input id="current-password" type="password" className="input-field" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="new-password" className="field-label">New password</label>
            <input id="new-password" type="password" className="input-field" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
          </div>
          <div>
            <label htmlFor="confirm-password" className="field-label">Confirm new password</label>
            <input id="confirm-password" type="password" className="input-field" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </div>
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <div className="flex justify-end">
          <button type="submit" className="secondary-btn" disabled={saving}>
            {saving && <Spinner />}
            Update password
          </button>
        </div>
      </form>
    </SettingsSection>
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
  const unavailable = loading || error;
  const figure = (value) => (unavailable || value === null || value === undefined ? '—' : value);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="reveal flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-ink font-serif text-4xl text-paper">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-[2.25rem] tracking-[-0.02em] leading-none text-ink">{displayName}</h1>
            <p className="mt-2 truncate text-sm text-ink-2">{user?.email}</p>
            <p className="mt-1 text-xs text-ink-3">
              Member since {formatDate(user?.metadata?.creationTime)}
              {stats?.last_interview_at && ` · Last interview ${formatDate(stats.last_interview_at)}`}
            </p>
          </div>
        </div>
        <button onClick={handleLogout} className="secondary-btn self-start hover:!border-bad/40 hover:!bg-bad-soft hover:!text-bad sm:self-auto">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </header>

      {error && <Notice tone="bad">{error}</Notice>}

      <section aria-label="Practice statistics" className="space-y-3">
        <StatRow i={1}>
          <Stat label="Total Interviews" value={figure(stats?.total_interviews)} hint="Standard and Arena" />
          <Stat label="Completed" value={figure(stats?.completed_interviews)} hint="Finished sessions" />
          <Stat label="Average Score" value={figure(stats?.average_score)} suffix="%" hint="Completed sessions" />
          <Stat label="Best Score" value={figure(stats?.best_score)} suffix="%" hint="Highest result" />
        </StatRow>
        <p className="reveal flex flex-wrap gap-x-6 gap-y-1 px-1 text-[13px] text-ink-3" style={{ '--i': 2 }}>
          <span>Standard interviews <span className="num ml-1 font-mono text-ink">{figure(stats?.standard_interviews)}</span></span>
          <span>Arena sessions <span className="num ml-1 font-mono text-ink">{figure(stats?.arena_sessions)}</span></span>
          <span>Practice time <span className="num ml-1 font-mono text-ink">{unavailable ? '—' : formatTotalTime(stats?.total_practice_seconds)}</span></span>
        </p>
      </section>

      <AccountDetails user={user} onSaved={setProfile} i={3} />
      <ChangePassword i={4} />
    </div>
  );
}
