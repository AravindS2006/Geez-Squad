import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieve: vi.fn(),
  findBilling: vi.fn(),
  findEvent: vi.fn(),
  updateBilling: vi.fn(),
  createEvent: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class Stripe {
    webhooks = { constructEvent: fixtures.constructEvent };
    subscriptions = { retrieve: fixtures.retrieve };
  },
}));
vi.mock('@/lib/db', () => ({
  db: {
    webhookEvent: { findUnique: fixtures.findEvent },
    billingSubscription: { findUnique: fixtures.findBilling },
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({
        webhookEvent: { findUnique: fixtures.findEvent, create: fixtures.createEvent },
        billingSubscription: { updateMany: fixtures.updateBilling },
      }),
  },
}));
import { POST } from '../src/app/api/billing/webhook/route';

describe('billing webhook reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'local-test-key');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'local-test-signing-key');
    fixtures.findEvent.mockResolvedValue(null);
    fixtures.findBilling.mockResolvedValue({
      id: 'billing',
      subscriptionId: 'current',
      updatedAt: new Date(0),
    });
    fixtures.constructEvent.mockReturnValue({
      id: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'old', customer: 'customer' } },
    });
    fixtures.retrieve.mockResolvedValue({ id: 'old', customer: 'customer', status: 'canceled' });
    fixtures.updateBilling.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  const request = () =>
    new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'test-signature' },
      body: 'signed-test-body',
    });
  it('acknowledges a previous subscription cancellation without overwriting the current one', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(fixtures.updateBilling).not.toHaveBeenCalled();
    expect(fixtures.createEvent).toHaveBeenCalledWith({ data: { id: 'event' } });
  });
  it('requests a retry when a different event commits during the Stripe read', async () => {
    fixtures.retrieve.mockResolvedValue({
      id: 'current',
      customer: 'customer',
      status: 'canceled',
    });
    fixtures.updateBilling.mockResolvedValue({ count: 0 });
    expect((await POST(request())).status).toBe(500);
    expect(fixtures.createEvent).not.toHaveBeenCalled();
    expect(fixtures.updateBilling).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'billing', subscriptionId: 'current', updatedAt: new Date(0) },
      }),
    );
    expect(fixtures.findBilling.mock.invocationCallOrder[0]).toBeLessThan(
      fixtures.retrieve.mock.invocationCallOrder[0],
    );
  });
  it('logs why processing failed, with the event id and type but no payload', async () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixtures.retrieve.mockRejectedValue(new Error('Stripe timeout for cus_private@example.test'));
    expect((await POST(request())).status).toBe(500);
    const line = output.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.includes('billing_webhook_failed'))!;
    expect(JSON.parse(line)).toMatchObject({
      route: '/api/billing/webhook',
      targetId: 'event',
      action: 'customer.subscription.deleted',
      type: 'Error',
    });
    expect(line).not.toMatch(/example\.test|signed-test-body/);
    output.mockRestore();
  });
  it('deduplicates a previously processed event before contacting Stripe', async () => {
    fixtures.findEvent.mockResolvedValue({ id: 'event' });
    expect((await POST(request())).status).toBe(200);
    expect(fixtures.retrieve).not.toHaveBeenCalled();
  });
  it('acknowledges and records an event for a customer this app never registered', async () => {
    fixtures.findBilling.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(200);
    expect(fixtures.retrieve).not.toHaveBeenCalled();
    expect(fixtures.updateBilling).not.toHaveBeenCalled();
    expect(fixtures.createEvent).toHaveBeenCalledWith({ data: { id: 'event' } });
  });
  it('records a checkout event without a customer instead of retrying forever', async () => {
    fixtures.constructEvent.mockReturnValue({
      id: 'event',
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub', customer: null } },
    });
    expect((await POST(request())).status).toBe(200);
    expect(fixtures.findBilling).not.toHaveBeenCalled();
    expect(fixtures.createEvent).toHaveBeenCalledWith({ data: { id: 'event' } });
  });
  it('rejects an invalid signature before reading billing data', async () => {
    fixtures.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    expect((await POST(request())).status).toBe(400);
    expect(fixtures.findBilling).not.toHaveBeenCalled();
  });
});
