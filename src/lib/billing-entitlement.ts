import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './security';
import { billingEnabled, hasStudioEntitlement } from './billing-policy';

type Store = Pick<Prisma.TransactionClient, 'studio' | 'studioRoleGrant' | 'billingSubscription'>;

/**
 * Paid-feature gate. With billing disabled (no Stripe settings, the default)
 * this is a no-op, so behaviour is unchanged. With billing enabled, a studio is
 * entitled when its owner or any active admin holds an active or trialing
 * subscription: checkout is open to every studio admin (`/api/billing`), and the
 * subscription is recorded against the admin who paid.
 */
export async function requireStudioEntitlement(
  studioId: string,
  store: Store = db,
  env: Record<string, string | undefined> = process.env,
) {
  if (!billingEnabled(env)) return;
  const [studio, admins] = await Promise.all([
    store.studio.findUnique({ where: { id: studioId }, select: { ownerId: true } }),
    store.studioRoleGrant.findMany({
      where: { studioId, role: 'admin', status: 'active' },
      select: { userId: true },
    }),
  ]);
  const payers = [...new Set([studio?.ownerId, ...admins.map((a) => a.userId)])].filter(
    (id): id is string => !!id,
  );
  const subscriptions = payers.length
    ? await store.billingSubscription.findMany({
        where: { userId: { in: payers } },
        select: { status: true },
      })
    : [];
  if (!hasStudioEntitlement(subscriptions.map((s) => s.status)))
    throw new ApiError(
      402,
      'An active studio subscription is required to start live classes. A studio admin can subscribe or fix payment in Settings.',
      'SUBSCRIPTION_REQUIRED',
    );
}
