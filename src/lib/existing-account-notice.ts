import { existingAccountEmail, type RenderedEmail } from './email-templates';
import {
  claimExistingAccountEmail,
  releaseExistingAccountEmail,
  type RateLimitStore,
} from './verification-throttle';

export type ExistingAccountNoticeResult = 'sent' | 'throttled' | 'failed';

/**
 * Runs when a sign-up names an email that already has an account. Better Auth answers that
 * sign-up exactly like a new one (enumeration protection), so the only place the owner
 * learns about it is their own inbox. Never throws: the sign-up response must not change.
 */
export async function notifyExistingAccountSignUp({
  store,
  user,
  loginUrl,
  send,
  now = Date.now(),
}: {
  store: RateLimitStore;
  user: { id: string; email: string; name?: string | null };
  loginUrl: string;
  send: (to: string, mail: RenderedEmail) => Promise<void>;
  now?: number;
}): Promise<ExistingAccountNoticeResult> {
  try {
    if (!(await claimExistingAccountEmail(store, user.id, now))) return 'throttled';
  } catch {
    return 'failed';
  }
  try {
    await send(user.email, existingAccountEmail({ name: user.name, url: loginUrl }));
    return 'sent';
  } catch {
    // Give the window back so the owner's next attempt can still be told.
    await releaseExistingAccountEmail(store, user.id, now).catch(() => undefined);
    return 'failed';
  }
}
