import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import PasswordInput from '../components/PasswordInput';
import { Notice, Spinner } from '../components/ui';

// -------------------------------------------------------------
// Account creation with client-side validation before calling Firebase.
// -------------------------------------------------------------

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendlyFirebaseError(error) {
  const code = error?.code || '';
  if (code.includes('email-already-in-use')) return 'An account already exists with this email.';
  if (code.includes('weak-password')) return 'Please choose a stronger password.';
  if (code.includes('invalid-email')) return 'Please enter a valid email address.';
  if (code.includes('network-request-failed')) return 'Network error. Check your connection and try again.';
  return 'Unable to create your account right now. Please try again.';
}

function FieldError({ children }) {
  return children ? <p className="fade-in mt-1.5 text-xs text-bad">{children}</p> : null;
}

export default function Signup() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [firebaseError, setFirebaseError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const validate = () => {
    const next = {};
    if (!form.fullName.trim()) next.fullName = 'Full name is required.';
    if (!form.email.trim()) next.email = 'Email is required.';
    else if (!emailPattern.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (!form.password) next.password = 'Password is required.';
    else if (form.password.length < 6) next.password = 'Password must be at least 6 characters.';
    if (!form.confirmPassword) next.confirmPassword = 'Please confirm your password.';
    else if (form.password !== form.confirmPassword) next.confirmPassword = 'Passwords do not match.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFirebaseError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signup(form.fullName.trim(), form.email.trim(), form.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setFirebaseError(friendlyFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      description="Set up a profile and run your first practice interview in a few minutes."
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}
    >
      {firebaseError && <Notice tone="bad" className="mb-5">{firebaseError}</Notice>}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="fullName" className="field-label">Full Name</label>
          <input id="fullName" className="input-field" value={form.fullName} onChange={(e) => updateField('fullName', e.target.value)} placeholder="Your full name" autoComplete="name" />
          <FieldError>{errors.fullName}</FieldError>
        </div>
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" type="email" className="input-field" value={form.email} onChange={(e) => updateField('email', e.target.value)} placeholder="you@example.com" autoComplete="email" />
          <FieldError>{errors.email}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className="field-label">Password</label>
            <PasswordInput id="password" value={form.password} onChange={(e) => updateField('password', e.target.value)} placeholder="6+ characters" autoComplete="new-password" />
            <FieldError>{errors.password}</FieldError>
          </div>
          <div>
            <label htmlFor="confirmPassword" className="field-label">Confirm Password</label>
            <input id="confirmPassword" type="password" className="input-field" value={form.confirmPassword} onChange={(e) => updateField('confirmPassword', e.target.value)} placeholder="Repeat it" autoComplete="new-password" />
            <FieldError>{errors.confirmPassword}</FieldError>
          </div>
        </div>
        <button className="primary-btn mt-2 w-full !py-3" disabled={submitting}>
          {submitting ? <><Spinner /> Creating Account…</> : <>Create Account <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>
    </AuthShell>
  );
}
