/**
 * One verification email per user per window. Sign-up, sign-in (sendOnSignIn) and
 * the "Resend" button each ask Better Auth to send, so a user who signs up and then
 * signs in, or signs in and taps Resend, would otherwise get several emails at once.
 * The earlier link stays valid (1 hour), so skipping a send inside the window loses
 * nothing. The claim is atomic: a unique insert, or a conditional update of a stale row.
 */
export const VERIFICATION_EMAIL_WINDOW_MS = 60_000;
/**
 * One "you already have an account" email per user per window. Anyone can trigger it by
 * signing up with the address, so the window is long enough that it cannot flood an inbox.
 */
export const EXISTING_ACCOUNT_EMAIL_WINDOW_MS = 15 * 60_000;

export type RateLimitStore = {
  create(args: { data: { key: string; count: number; lastRequest: bigint } }): Promise<unknown>;
  updateMany(args: {
    where: { key: string; lastRequest: { lt: bigint } | bigint };
    data: { count?: { increment: number }; lastRequest: bigint };
  }): Promise<{ count: number }>;
};

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

async function claimMailWindow(store: RateLimitStore, key: string, now: number, windowMs: number) {
  try {
    await store.create({ data: { key, count: 1, lastRequest: BigInt(now) } });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const claimed = await store.updateMany({
    where: { key, lastRequest: { lt: BigInt(now - windowMs) } },
    data: { count: { increment: 1 }, lastRequest: BigInt(now) },
  });
  return claimed.count === 1;
}

async function releaseMailWindow(store: RateLimitStore, key: string, claimedAt: number) {
  await store.updateMany({
    where: { key, lastRequest: BigInt(claimedAt) },
    data: { lastRequest: BigInt(0) },
  });
}

export function claimVerificationEmail(
  store: RateLimitStore,
  userId: string,
  now = Date.now(),
  windowMs = VERIFICATION_EMAIL_WINDOW_MS,
) {
  return claimMailWindow(store, `mail:verify:${userId}`, now, windowMs);
}

/** Gives the window back when delivery failed, so the user can retry at once. */
export function releaseVerificationEmail(store: RateLimitStore, userId: string, claimedAt: number) {
  return releaseMailWindow(store, `mail:verify:${userId}`, claimedAt);
}

export function claimExistingAccountEmail(
  store: RateLimitStore,
  userId: string,
  now = Date.now(),
  windowMs = EXISTING_ACCOUNT_EMAIL_WINDOW_MS,
) {
  return claimMailWindow(store, `mail:existing:${userId}`, now, windowMs);
}

export function releaseExistingAccountEmail(
  store: RateLimitStore,
  userId: string,
  claimedAt: number,
) {
  return releaseMailWindow(store, `mail:existing:${userId}`, claimedAt);
}
