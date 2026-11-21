import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db, databaseProvider } from './db';
import { sendMail } from './mail';
import { getEmailPolicy } from './email-policy.mjs';
import { logEvent } from './logger';
import { requestContext } from './request-log';
import { allowedOrigins } from './origins';
import { passwordResetEmail, verificationEmail } from './email-templates';
import { claimVerificationEmail, releaseVerificationEmail } from './verification-throttle';
export const emailPolicy = getEmailPolicy(process.env);
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
          await sendMail(user.email, passwordResetEmail({ name: user.name, url }));
        }
      : undefined,
  },
  emailVerification: emailPolicy.deliveryEnabled
    ? {
        autoSignInAfterVerification: true,
        sendOnSignUp: true,
        sendOnSignIn: true,
        sendVerificationEmail: async ({ user, url }) => {
          // Sign-up, sign-in and Resend can all fire within seconds; send once per window.
          const claimedAt = Date.now();
          if (!(await claimVerificationEmail(db.rateLimit, user.id, claimedAt))) {
            logEvent('info', 'mail_verification_deduplicated', requestContext.getStore());
            return;
          }
          try {
            await sendMail(user.email, verificationEmail({ name: user.name, url }));
          } catch (error) {
            await releaseVerificationEmail(db.rateLimit, user.id, claimedAt);
            throw error;
          }
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
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
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
