import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import PasswordInput from '../components/PasswordInput';
import { Notice, Spinner } from '../components/ui';

// -------------------------------------------------------------
// Sign-in page. Firebase error codes are mapped to short messages; wrong
// email and wrong password share one message so accounts cannot be probed.
// -------------------------------------------------------------

function friendlyFirebaseError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait and try again.';
  if (code.includes('network-request-failed')) return 'Network error. Check your connection and try again.';
  return 'Unable to sign in right now. Please check your details and try again.';
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(friendlyFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to pick up your interview practice where you left it."
      footer={<>New here? <Link to="/signup" className="link">Create an account</Link></>}
    >
      {error && <Notice tone="bad" className="mb-5">{error}</Notice>}
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" type="email" className="input-field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] font-medium text-ink-2">Password</label>
            <Link to="/forgot-password" className="text-[13px] text-ink-3 transition hover:text-ink">Forgot Password?</Link>
          </div>
          <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" required />
        </div>
        <button className="primary-btn w-full !py-3" disabled={submitting}>
          {submitting ? <><Spinner /> Signing In…</> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>
    </AuthShell>
  );
}
