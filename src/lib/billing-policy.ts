/** A late cancellation/expiry for a previous subscription must not replace the
 * customer's newer subscription. Stripe does not guarantee event ordering. */
export function shouldReconcileSubscription(
  currentId: string | null,
  incomingId: string,
  incomingStatus: string,
) {
  return (
    !currentId ||
    currentId === incomingId ||
    !['canceled', 'incomplete_expired'].includes(incomingStatus)
  );
}

/** The three Stripe settings the checkout route requires. Billing is off unless all are set. */
export function billingEnabled(env: Record<string, string | undefined>) {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Subscription states that pay for the studio's live classes. `past_due`,
 * `unpaid` and `incomplete` are not entitled: the admin is sent to the billing
 * portal to fix payment before the next class starts. A class already live is
 * never interrupted.
 */
export const ENTITLED_STATUSES = new Set(['active', 'trialing']);

export function hasStudioEntitlement(statuses: Array<string | null | undefined>) {
  return statuses.some((status) => !!status && ENTITLED_STATUSES.has(status));
}
