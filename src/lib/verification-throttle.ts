/**
 * One verification email per user per window. Sign-up, sign-in (sendOnSignIn) and
 * the "Resend" button each ask Better Auth to send, so a user who signs up and then
 * signs in, or signs in and taps Resend, would otherwise get several emails at once.
 * The earlier link stays valid (1 hour), so skipping a send inside the window loses
 * nothing. The claim is atomic: a unique insert, or a conditional update of a stale row.
 */
export const VERIFICATION_EMAIL_WINDOW_MS = 60_000;

type RateLimitStore = {
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

export async function claimVerificationEmail(
  store: RateLimitStore,
  userId: string,
  now = Date.now(),
  windowMs = VERIFICATION_EMAIL_WINDOW_MS,
) {
  const key = `mail:verify:${userId}`;
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

/** Gives the window back when delivery failed, so the user can retry at once. */
export async function releaseVerificationEmail(
  store: RateLimitStore,
  userId: string,
  claimedAt: number,
) {
  await store.updateMany({
    where: { key: `mail:verify:${userId}`, lastRequest: BigInt(claimedAt) },
    data: { lastRequest: BigInt(0) },
  });
}
