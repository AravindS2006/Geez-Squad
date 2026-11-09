import { describe, it, expect } from 'vitest';
import { deletionBlocker } from '../src/lib/account-deletion-policy';

describe('account deletion policy', () => {
  it('refuses studio owners so a studio and its payment records are never cascaded', () => {
    expect(deletionBlocker({ ownsStudio: true })?.code).toBe('STUDIO_OWNER');
    expect(deletionBlocker({ ownsStudio: true, billingStatus: 'canceled' })?.code).toBe(
      'STUDIO_OWNER',
    );
  });
  it('requires open subscriptions to be cancelled first', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])
      expect(deletionBlocker({ ownsStudio: false, billingStatus: status })?.code).toBe(
        'BILLING_ACTIVE',
      );
  });
  it('allows members, coaches and closed subscriptions', () => {
    expect(deletionBlocker({ ownsStudio: false })).toBeNull();
    expect(deletionBlocker({ ownsStudio: false, billingStatus: 'canceled' })).toBeNull();
    expect(deletionBlocker({ ownsStudio: false, billingStatus: 'inactive' })).toBeNull();
  });
});
