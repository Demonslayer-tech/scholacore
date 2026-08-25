import { useState } from 'react';
import { signUpWithEmail, signInWithEmail, signInWithTelegramToken, getAuthToken } from '../../lib/firebase';
import Logo from '../Logo';

interface WebAuthProps {
  onAuthenticated: (customToken: string, user: unknown) => void;
}

/**
 * Firebase's own email/password SDK methods do the actual authentication
 * client-side — no server round-trip needed for that part. What comes
 * after (sign-up vs sign-in) both funnel into /api/auth-web, which
 * reconciles the role custom claim and returns the same
 * { customToken, user } shape the Telegram path uses, so App.tsx doesn't
 * need to know which path a session came from.
 */
export default function WebAuth({ onAuthenticated }: WebAuthProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const emailValid = /\S+@\S+\.\S+/.test(email.trim());
  const passwordValid = password.length >= 6;

  const handleSubmit = async () => {
    if (!emailValid || !passwordValid) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      if (mode === 'signup') {
        await signUpWithEmail(email.trim(), password);
      } else {
        await signInWithEmail(email.trim(), password);
      }

      // Firebase Auth is now signed in with a plain (no role claim) token.
      // Exchange it for one that carries the real role.
      const idToken = await getAuthToken();
      if (!idToken) throw new Error('Sign-in succeeded but no session token was issued — try again.');

      const res = await fetch('/api/auth-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not complete sign-in');

      await signInWithTelegramToken(data.customToken); // works for any custom token, not Telegram-specific
      onAuthenticated(data.customToken, data.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      // Firebase's own error messages are usually clear enough to show
      // directly (e.g. "auth/email-already-in-use", "auth/wrong-password")
      // — strip the "Firebase: " / code prefix for readability.
      setErrorMessage(message.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[a-z-]+\)\.?$/, ''));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-core-50 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <Logo className="h-12 w-12 text-brand-500" />
          <p className="mt-3 font-sans text-2xl font-bold text-core-950">ScholaCore</p>
          <p className="mt-1 text-sm text-core-600">
            {mode === 'signup' ? 'Create your account to get started.' : 'Welcome back.'}
          </p>
        </div>

        <div className="space-y-3 rounded-card border border-core-100 bg-white p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-core-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-core-600">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
              placeholder="At least 6 characters"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!emailValid || !passwordValid || submitting}
          className="w-full rounded-card bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        {errorMessage && <p className="text-center text-xs text-signal-danger">{errorMessage}</p>}

        <button
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setErrorMessage(null);
          }}
          className="w-full text-center text-xs text-core-600"
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}
