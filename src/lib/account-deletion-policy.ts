/** Payment subscriptions that must be cancelled in the billing portal before erasure. */
const OPEN_BILLING = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';

export function deletionBlocker({
  ownsStudio,
  billingStatus,
}: {
  ownsStudio: boolean;
  billingStatus?: string | null;
}): { code: string; message: string } | null {
  if (ownsStudio)
    return {
      code: 'STUDIO_OWNER',
      message:
        'Studio owners cannot delete their account here because it would erase the studio, its members and payment records. Export your data and contact the operator to close the studio.',
    };
  if (billingStatus && OPEN_BILLING.has(billingStatus))
    return {
      code: 'BILLING_ACTIVE',
      message: 'Cancel your subscription in the billing portal before deleting your account.',
    };
  return null;
}
