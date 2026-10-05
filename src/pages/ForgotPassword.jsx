import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import { Notice, Spinner } from '../components/ui';

// -------------------------------------------------------------
// Password reset. The success message is shown even for unknown emails so
// the page does not reveal which addresses have accounts.
// -------------------------------------------------------------

function friendlyResetError(error) {
  const code = error?.code || '';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait and try again.';
  if (code.includes('network-request-failed')) return 'Network error. Check your connection and try again.';
  return 'Unable to send a reset link right now. Please try again.';
}

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess(false);
    setSubmitting(true);

    try {
      await resetPassword(email.trim());
      setSuccess(true);
    } catch (err) {
      if (err?.code?.includes('user-not-found')) {
        setSuccess(true);
      } else {
        setError(friendlyResetError(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account email and we will send you a link to choose a new password."
      footer={(
        <Link to="/login" className="inline-flex items-center gap-1.5 text-ink-2 transition hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      )}
    >
      {success && (
        <Notice tone="ok" className="mb-5">
          If an account exists for that email, a password reset link has been sent.
        </Notice>
      )}
      {error && <Notice tone="bad" className="mb-5">{error}</Notice>}
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="reset-email" className="field-label">Email</label>
          <input
            id="reset-email"
            type="email"
            className="input-field"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <button className="primary-btn w-full !py-3" disabled={submitting}>
          {submitting ? <><Spinner /> Sending…</> : 'Send Reset Link'}
        </button>
      </form>
    </AuthShell>
  );
}
