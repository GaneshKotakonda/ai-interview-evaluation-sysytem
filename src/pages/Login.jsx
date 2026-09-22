import { useState } from 'react';
import { Eye, EyeOff, LoaderCircle, Mic } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/10"><Mic className="h-6 w-6" /></div>
          <div>
            <p className="font-bold">AI Interview Evaluation System</p>
            <p className="text-sm text-slate-300">Academic Prototype</p>
          </div>
        </div>
        <div className="max-w-xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">Candidate Practice Workspace</p>
          <h1 className="text-5xl font-bold leading-tight">Practice interviews with a focused, measurable workflow.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">Complete a mock interview, capture responses, and review a transparent demonstration report designed for future AI integration.</p>
        </div>
        <p className="text-sm text-slate-400">Camera and microphone data remain in your browser during this prototype.</p>
      </section>

      <section className="flex items-center justify-center bg-slate-50 px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-navy-900 text-white"><Mic className="h-6 w-6" /></div>
            <h1 className="text-xl font-bold text-navy-900">AI Interview Evaluation System</h1>
          </div>
          <div className="card p-6 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-tealish-600">Practice. Evaluate. Improve.</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-500">Sign in to continue your interview practice.</p>

            {error && <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">Email</label>
                <input id="email" type="email" className="input-field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-navy-700 hover:text-navy-900"
                  >
                    Forgot Password?
                  </Link>
                </div>
                <div className="relative">
                  <input id="password" type={showPassword ? 'text' : 'password'} className="input-field pr-11" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <button className="primary-btn w-full" disabled={submitting}>
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {submitting ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">New to the platform? <Link to="/signup" className="font-semibold text-navy-700 hover:text-navy-900">Create an account</Link></p>
          </div>
        </div>
      </section>
    </div>
  );
}
