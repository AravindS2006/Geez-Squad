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
