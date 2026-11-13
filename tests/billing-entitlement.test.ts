import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('../src/lib/db', () => ({ db: {} }));
vi.mock('../src/lib/security', async () => {
  const { TestApiError } = await import('./route-mocks');
  return { ApiError: TestApiError };
});
import { requireStudioEntitlement } from '../src/lib/billing-entitlement';
import { billingEnabled, hasStudioEntitlement } from '../src/lib/billing-policy';

const enabled = {
  STRIPE_SECRET_KEY: 'local-test-key',
  STRIPE_PRICE_ID: 'local-test-price',
  STRIPE_WEBHOOK_SECRET: 'local-test-signing-key',
};

function store(statuses: Record<string, string>, ownerId = 'owner', admins: string[] = []) {
  const findMany = vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
    where.userId.in.filter((id) => statuses[id]).map((id) => ({ status: statuses[id] })),
  );
  return {
    studio: { findUnique: vi.fn(async () => ({ ownerId })) },
    studioRoleGrant: { findMany: vi.fn(async () => admins.map((userId) => ({ userId }))) },
    billingSubscription: { findMany },
  };
}

describe('billing configuration', () => {
  it('is enabled only with all three Stripe settings', () => {
    expect(billingEnabled(enabled)).toBe(true);
    expect(billingEnabled({ ...enabled, STRIPE_PRICE_ID: '' })).toBe(false);
    expect(billingEnabled({})).toBe(false);
  });
  it('entitles active and trialing subscriptions only', () => {
    expect(hasStudioEntitlement(['active'])).toBe(true);
    expect(hasStudioEntitlement(['canceled', 'trialing'])).toBe(true);
    for (const status of ['past_due', 'unpaid', 'incomplete', 'canceled', 'inactive', null])
      expect(hasStudioEntitlement([status])).toBe(false);
    expect(hasStudioEntitlement([])).toBe(false);
  });
});

describe('live class entitlement gate', () => {
  it('changes nothing while billing is disabled', async () => {
    const s = store({});
    await expect(requireStudioEntitlement('studio', s as never, {})).resolves.toBeUndefined();
    expect(s.studio.findUnique).not.toHaveBeenCalled();
  });
  it('refuses an unpaid studio with 402 when billing is enabled', async () => {
    await expect(
      requireStudioEntitlement('studio', store({ owner: 'past_due' }) as never, enabled),
    ).rejects.toMatchObject({ status: 402, code: 'SUBSCRIPTION_REQUIRED' });
  });
  it('accepts a subscription held by the owner or an active admin', async () => {
    await expect(
      requireStudioEntitlement('studio', store({ owner: 'active' }) as never, enabled),
    ).resolves.toBeUndefined();
    await expect(
      requireStudioEntitlement(
        'studio',
        store({ admin: 'trialing' }, 'owner', ['admin']) as never,
        enabled,
      ),
    ).resolves.toBeUndefined();
  });
  it('ignores subscriptions of people who are not studio admins', async () => {
    const s = store({ stranger: 'active' }, 'owner', ['admin']);
    await expect(requireStudioEntitlement('studio', s as never, enabled)).rejects.toMatchObject({
      status: 402,
    });
    expect(s.billingSubscription.findMany.mock.calls[0][0].where.userId.in).toEqual([
      'owner',
      'admin',
    ]);
  });
});
