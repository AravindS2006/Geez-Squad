import { describe, expect, it } from 'vitest';
import { shouldReconcileSubscription } from '../src/lib/billing-policy';

describe('subscription replacement webhooks', () => {
  it.each(['canceled', 'incomplete_expired'])(
    'does not let an old %s subscription replace the current subscription',
    (status) => {
      expect(shouldReconcileSubscription('new-subscription', 'old-subscription', status)).toBe(
        false,
      );
    },
  );
  it('still applies cancellation of the current subscription', () => {
    expect(shouldReconcileSubscription('current', 'current', 'canceled')).toBe(true);
  });
  it('allows a replacement subscription and first-time reconciliation', () => {
    expect(shouldReconcileSubscription('old', 'new', 'active')).toBe(true);
    expect(shouldReconcileSubscription(null, 'first', 'canceled')).toBe(true);
  });
});
