import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({ create: vi.fn(), findBilling: vi.fn() }));
vi.mock('@/lib/security', async () => {
  const { TestApiError, testSafeError } = await import('./route-mocks');
  return {
    ApiError: TestApiError,
    safeError: testSafeError,
    requireUser: async () => ({ id: 'owner', email: 'owner@example.test', name: 'Owner' }),
    readJson: (request: Request) => request.json(),
    rateLimit: async () => undefined,
  };
});
vi.mock('@/lib/studio-access', () => ({
  requireStudio: async () => ({ studio: { id: 'studio' } }),
}));
vi.mock('@/lib/db', () => ({ db: { billingSubscription: { findUnique: fx.findBilling } } }));
vi.mock('stripe', () => ({
  default: class Stripe {
    customers = { create: fx.create };
  },
}));
import { POST } from '../src/app/api/billing/route';
afterEach(() => vi.unstubAllEnvs());
it('reports billing as unavailable when the public app URL is not configured', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'local-test-key');
  vi.stubEnv('STRIPE_PRICE_ID', 'local-test-price');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'local-test-signing-key');
  vi.stubEnv('BETTER_AUTH_URL', '');
  const response = await POST(
    new Request('http://localhost/api/billing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'portal' }),
    }),
  );
  expect(response.status).toBe(503);
  expect(fx.findBilling).not.toHaveBeenCalled();
  expect(fx.create).not.toHaveBeenCalled();
});
