'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, Eye, EyeOff, ArrowRight, Check } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Brand, MotionArt } from './ui';
import { loginDestination } from '@/lib/login-destination';
export function AuthForm({
  testingMode,
  signupEnabled,
  passwordResetEnabled,
}: {
  testingMode: boolean;
  signupEnabled: boolean;
  passwordResetEnabled: boolean;
}) {
  const params = useSearchParams();
  const token = params.get('token'),
    invite = params.get('invite');
  const destination = loginDestination(params.get('next'));
  const signedInDestination = invite ? `/invite?code=${encodeURIComponent(invite)}` : destination;
  const [mode, setMode] = useState(
      token && passwordResetEnabled
        ? 'reset'
        : params.get('mode') === 'signup' && signupEnabled
          ? 'signup'
          : 'login',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [visible, setVisible] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if ((mode === 'signup' && !signupEnabled) || (mode === 'forgot' && !passwordResetEnabled)) {
      setError('This account action is temporarily unavailable.');
      setBusy(false);
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || ''),
      password = String(form.get('password') || '');
    const callbackURL = invite
      ? `/login?invite=${encodeURIComponent(invite)}`
      : destination !== '/app'
        ? `/login?next=${encodeURIComponent(destination)}`
        : '/login';
    try {
      if (mode === 'forgot') {
        const r = await authClient.requestPasswordReset({ email, redirectTo: callbackURL });
        if (r.error) throw new Error(r.error.message);
        setNotice('If this email has an account, you will receive a password reset link.');
      } else if (mode === 'reset') {
        const r = await authClient.resetPassword({ newPassword: password, token: token || '' });
        if (r.error) throw new Error(r.error.message);
        setNotice('Your password is updated. Sign in to continue.');
        setMode('login');
      } else {
        const result =
          mode === 'signup'
            ? await authClient.signUp.email({
                email,
                password,
                name: String(form.get('name') || ''),
                callbackURL,
              })
            : await authClient.signIn.email({ email, password, callbackURL: signedInDestination });
        if (result.error) {
          if (result.error.code === 'EMAIL_NOT_VERIFIED' && passwordResetEnabled) {
            setNotice('Check your email for a verification link, then sign in again.');
            return;
          }
          throw new Error(result.error.message);
        }
        const session = await authClient.getSession();
        if (!session.data) {
          setNotice('Check your email to verify your account, then sign in.');
          setMode('login');
        } else window.location.href = signedInDestination;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/app">
          <Brand />
        </Link>
        <div>
          <span className="eyebrow">HUMAN CONNECTION. SMARTER MOVEMENT.</span>
          <h1>
            Better together.
            <br />
            <em>Stronger every day.</em>
          </h1>
          <p>
            A little guidance changes everything. Bring your coach, your goals, and your next
            chapter into one space.
          </p>
          <MotionArt />
          <div className="auth-benefits">
            <span>
              <Check size={16} /> Live coaching
            </span>
            <span>
              <Check size={16} /> Private camera analysis
            </span>
            <span>
              <Check size={16} /> Meaningful progress
            </span>
          </div>
        </div>
        <span className="auth-foot">MOVE WITH INTENTION.</span>
      </section>
      <section className="auth-content">
        <Link href="/demo" className="text-link auth-demo">
          Explore the sample studio <ArrowUpRight size={16} />
        </Link>
        <form onSubmit={submit} className="auth-form">
          <span className="eyebrow">YOUR NEXT REP STARTS HERE</span>
          <h2>
            {mode === 'signup'
              ? 'Make yourself stronger.'
              : mode === 'forgot'
                ? 'A fresh start.'
                : mode === 'reset'
                  ? 'Set your new password.'
                  : 'Welcome back.'}
          </h2>
          <p>
            {mode === 'signup'
              ? 'Create an account for your coaching journey.'
              : mode === 'login'
                ? 'Your studio is ready when you are.'
                : 'Let’s get you back to your studio.'}
          </p>
          {testingMode && (
            <p className="inline-notice" role="status">
              Testing mode: email verification is off. Use your own email and save your password;
              email recovery is unavailable.
            </p>
          )}
          {mode === 'signup' && (
            <label>
              Your name
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                placeholder="Alex Morgan"
              />
            </label>
          )}
          {mode !== 'reset' && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? 'text' : 'password'}
                  required
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={128}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'signup' ? 'At least 12 characters' : 'Your password'}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          )}
          {mode === 'login' && passwordResetEnabled && (
            <button
              type="button"
              className="text-link forgot"
              onClick={() => {
                setMode('forgot');
                setError('');
              }}
            >
              Forgot password?
            </button>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="inline-notice" role="status">
              {notice}
            </p>
          )}
          <button className="button dark full" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'signup'
                ? 'Create account'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Update password'}
            <ArrowRight size={17} />
          </button>
          {!signupEnabled && (
            <p className="inline-notice" role="status">
              New account registration and password reset are temporarily unavailable. You can
              explore the sample studio above.
            </p>
          )}
          {signupEnabled && (
            <p className="auth-switch">
              {mode === 'login' ? 'New to Geez Squad?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                  setNotice('');
                }}
              >
                {mode === 'login' ? 'Create account' : 'Sign in'}
              </button>
            </p>
          )}
          <p className="microcopy">
            For adults 18+. Camera coaching supports general fitness; your coach remains in charge.{' '}
            <Link href="/privacy">Privacy & camera use</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
