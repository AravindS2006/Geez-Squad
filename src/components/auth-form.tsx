'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import '@/app/auth.css';
import { ArrowUpRight, Eye, EyeOff, ArrowRight, Check } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Brand } from './ui';
import { accountDestination, loginDestination } from '@/lib/login-destination';
export function AuthForm({
  testingMode,
  signupEnabled,
  passwordResetEnabled,
  verificationRequired = false,
}: {
  testingMode: boolean;
  signupEnabled: boolean;
  passwordResetEnabled: boolean;
  verificationRequired?: boolean;
}) {
  const params = useSearchParams();
  const token = params.get('token'),
    invite = params.get('invite');
  const destination = loginDestination(params.get('next'));
  const signedInDestination = accountDestination(params.get('next'), invite);
  const [mode, setMode] = useState(
      token && passwordResetEnabled
        ? 'reset'
        : verificationRequired || params.get('mode') === 'verify'
          ? 'verify'
          : params.get('mode') === 'signup' && signupEnabled
            ? 'signup'
            : 'login',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reference, setReference] = useState(''),
    [visible, setVisible] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setReference('');
    const requestOptions = {
      onError: (ctx: { response: Response }) =>
        setReference(ctx.response.headers.get('X-Request-ID') || ''),
    };
    if ((mode === 'signup' && !signupEnabled) || (mode === 'forgot' && !passwordResetEnabled)) {
      setError('This account action is temporarily unavailable.');
      setBusy(false);
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '')
        .trim()
        .toLowerCase(),
      password = String(form.get('password') || '');
    const callbackURL = invite
      ? `/login?invite=${encodeURIComponent(invite)}`
      : destination !== '/app'
        ? `/login?next=${encodeURIComponent(destination)}`
        : '/login';
    try {
      if (mode === 'verify') {
        if (!passwordResetEnabled)
          throw new Error('Email delivery is temporarily unavailable. Contact your studio.');
        const r = await authClient.sendVerificationEmail({ email, callbackURL }, requestOptions);
        if (r.error)
          throw new Error(
            r.error.status === 429
              ? 'Please wait a minute before requesting another email.'
              : 'Email could not be sent. Please retry shortly.',
          );
        setNotice(
          'If your account needs verification, a new link is on its way. Check your inbox and spam folder.',
        );
      } else if (mode === 'forgot') {
        const r = await authClient.requestPasswordReset(
          { email, redirectTo: callbackURL },
          requestOptions,
        );
        if (r.error)
          throw new Error(
            r.error.status === 429
              ? 'Please wait a minute before trying again.'
              : 'Email could not be sent. Please retry shortly.',
          );
        setNotice('If this email has an account, you will receive a password reset link.');
      } else if (mode === 'reset') {
        const r = await authClient.resetPassword(
          { newPassword: password, token: token || '' },
          requestOptions,
        );
        if (r.error)
          throw new Error(
            'This reset link is invalid or expired. Request a new link using Forgot password.',
          );
        setNotice('Your password is updated. Sign in to continue.');
        setMode('login');
      } else {
        const result =
          mode === 'signup'
            ? await authClient.signUp.email(
                {
                  email,
                  password,
                  name: String(form.get('name') || ''),
                  callbackURL,
                },
                requestOptions,
              )
            : await authClient.signIn.email(
                { email, password, callbackURL: signedInDestination },
                requestOptions,
              );
        if (result.error) {
          if (result.error.code === 'EMAIL_NOT_VERIFIED' && passwordResetEnabled) {
            setMode('verify');
            setNotice('Check your email for a verification link, then sign in again.');
            return;
          }
          throw new Error(
            result.error.status === 429
              ? 'Too many attempts. Please wait a minute.'
              : result.error.status >= 500
                ? 'Sign-in is temporarily unavailable. Please retry shortly.'
                : result.error.message,
          );
        }
        const session = await authClient.getSession();
        if (session.error)
          throw new Error('Your account could not be loaded. Please retry shortly.');
        if (!session.data) {
          setNotice('Check your email to verify your account, then sign in.');
          setMode('verify');
        } else window.location.href = signedInDestination;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page auth-studio">
      <section className="auth-story">
        <Link href="/" aria-label="Geez Squad home">
          <Brand />
        </Link>
        <div>
          <span className="eyebrow">YOUR STUDIO. YOUR SQUAD.</span>
          <h2>
            A place to move.
            <br />
            <em>A reason to return.</em>
          </h2>
          <p>Your memberships, classes and coaching, together in one place.</p>
          <div className="auth-photo">
            <Image
              src="/images/studio-hero.png"
              alt=""
              fill
              sizes="(min-width: 900px) 45vw, 1px"
              priority
            />
          </div>
          <div className="auth-benefits">
            <span>
              <Check size={16} /> Memberships
            </span>
            <span>
              <Check size={16} /> Classes & coaching
            </span>
            <span>
              <Check size={16} /> Your progress
            </span>
          </div>
        </div>
        <span className="auth-foot">STRONGER, TOGETHER.</span>
      </section>
      <section className="auth-content">
        <Link href="/demo" className="text-link auth-demo">
          Explore the sample studio <ArrowUpRight size={16} />
        </Link>
        <form onSubmit={submit} className="auth-form">
          <span className="eyebrow">GEEZ SQUAD / YOUR ACCOUNT</span>
          <h1>
            {mode === 'verify'
              ? 'Check your inbox.'
              : mode === 'signup'
                ? 'Your stronger starts here.'
                : mode === 'forgot'
                  ? 'A fresh start.'
                  : mode === 'reset'
                    ? 'Set your new password.'
                    : 'Welcome back.'}
          </h1>
          <p>
            {mode === 'verify'
              ? 'Confirm your email to keep your studio records private.'
              : mode === 'signup'
                ? 'Use your personal email. Your coach can connect you to the studio after you sign up.'
                : mode === 'login'
                  ? 'Your studio is ready when you are.'
                  : 'Let’s get you back to your studio.'}
          </p>
          {params.get('error') && (
            <p className="inline-error" role="alert">
              This email link is invalid or expired. Request a new verification or password reset
              link.
            </p>
          )}
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
          {mode !== 'forgot' && mode !== 'verify' && (
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
          {reference && (
            <button
              type="button"
              className="text-link auth-reference"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(reference);
                  setNotice('Support reference copied.');
                } catch {
                  setNotice(`Support reference: ${reference}`);
                }
              }}
            >
              Copy support reference
            </button>
          )}
          {notice && (
            <p className="inline-notice" role="status">
              {notice}
            </p>
          )}
          <button className="button dark full" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'verify'
                ? 'Resend verification email'
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
          {mode === 'login' && passwordResetEnabled && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setMode('verify');
                setError('');
                setNotice('');
              }}
            >
              Need to verify your email?
            </button>
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
