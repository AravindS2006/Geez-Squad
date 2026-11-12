import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { db, databaseProvider } from './db';
import { sendMail } from './mail';
import { getEmailPolicy } from './email-policy.mjs';
import { logEvent } from './logger';
import { requestContext } from './request-log';
import { allowedOrigins } from './origins';
export const emailPolicy = getEmailPolicy(process.env);
/**
 * Seconds a signed session cookie may stand in for the Session table lookup. A session
 * revoked elsewhere (sign-out on another device, password reset, account deletion)
 * stops authenticating within this bound; studio, membership, assignment and cue
 * permissions are never cached and are read from the database on every request.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 60;
export const auth = betterAuth({
  logger: {
    level: 'debug',
    log: (level) => logEvent(level, 'auth_event', requestContext.getStore()),
  },
  appName: 'Geez Squad',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {
    provider: databaseProvider(),
  }),
  trustedOrigins: allowedOrigins(),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !emailPolicy.signupEnabled,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: emailPolicy.requireVerification,
    sendResetPassword: emailPolicy.passwordResetEnabled
      ? async ({ user, url }) => {
          await sendMail(
            user.email,
            'Reset your Geez Squad password',
            `Reset your password: ${url}\nIf you did not request this, ignore this email.`,
          );
        }
      : undefined,
  },
  emailVerification: emailPolicy.deliveryEnabled
    ? {
        autoSignInAfterVerification: true,
        sendOnSignUp: true,
        sendOnSignIn: true,
        sendVerificationEmail: async ({ user, url }) => {
          await sendMail(
            user.email,
            'Verify your Geez Squad email',
            `Welcome to Geez Squad. Verify your email: ${url}`,
          );
        },
      }
    : undefined,
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'unset', input: false },
      goal: { type: 'string', defaultValue: 'Build strength & consistency', input: false },
      consentVersion: { type: 'string', required: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // No `refreshCache`: an expired cache must go back to the database, otherwise a
    // revoked session could keep renewing itself from the cookie alone.
    cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
  },
  // Lets server-side `auth.api.getSession` calls in route handlers re-issue the cache
  // cookie after a database lookup. Must stay the last plugin.
  plugins: [nextCookies()],
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 60, max: 8 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
    },
  },
});
