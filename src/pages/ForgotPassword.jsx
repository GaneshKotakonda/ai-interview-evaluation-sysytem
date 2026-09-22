import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle, Mic } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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
    <div className="min-h-screen bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-navy-900 text-white">
            <Mic className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold text-navy-900">AI Interview Evaluation System</p>
            <p className="text-sm text-slate-500">Account Recovery</p>
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Reset your password</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter your account email and we’ll send you a password reset link.
          </p>

          {success && (
            <div
              role="status"
              className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
            >
              If an account exists for that email, a password reset link has been sent.
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
            >
              {error}
            </div>
          )}
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="reset-email" className="mb-2 block text-sm font-medium text-slate-700">
                Email
              </label>
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

            <button className="primary-btn w-full" disabled={submitting}>
              {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {submitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Remembered your password?{' '}
            <Link to="/login" className="font-semibold text-navy-700 hover:text-navy-900">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
