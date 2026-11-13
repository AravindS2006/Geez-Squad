import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({
  safeError: () => Response.json({ error: 'Unexpected failure' }, { status: 500 }),
}));
const mocks = vi.hoisted(() => {
  const model = () => ({
    deleteMany: vi.fn(async (_args?: unknown) => ({ count: 0 })),
    findMany: vi.fn(async (_args?: unknown): Promise<{ id: string }[]> => []),
  });
  return {
    transaction: vi.fn(async (_ops: unknown) => []),
    webhookEvent: model(),
    auditEvent: model(),
    other: model(),
    completeAbandonedClasses: vi.fn(async () => ({ completed: 0 })),
  };
});
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: mocks.transaction,
    webhookEvent: mocks.webhookEvent,
    auditEvent: mocks.auditEvent,
    session: mocks.other,
    verification: mocks.other,
    invitation: mocks.other,
    rateLimit: mocks.other,
    metric: mocks.other,
    message: mocks.other,
  },
}));
vi.mock('@/lib/class-completion', () => ({
  completeAbandonedClasses: mocks.completeAbandonedClasses,
}));
import { GET } from '../src/app/api/retention/route';
import { DAY_MS } from '../src/lib/retention-policy';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const SECRET = 'x'.repeat(32);
const authorized = () =>
  new Request('http://localhost/api/retention', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
type ExpiredQuery = { where: { createdAt: { lt: Date } }; orderBy: unknown };
const ageInDays = (query: ExpiredQuery, before: number) =>
  Math.round((before - query.where.createdAt.lt.getTime()) / DAY_MS);

it('rejects same-character-length multi-byte authorization as 401 instead of throwing', async () => {
  vi.stubEnv('CRON_SECRET', SECRET);
  const response = await GET(
    new Request('http://localhost/api/retention', {
      headers: { authorization: `Bearer ${'é'.repeat(32)}` },
    }),
  );
  expect(response.status).toBe(401);
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.auditEvent.findMany).not.toHaveBeenCalled();
  expect(mocks.webhookEvent.findMany).not.toHaveBeenCalled();
});

it('prunes webhook events after 30 days and audit events after 400 days, oldest first by ID', async () => {
  vi.stubEnv('CRON_SECRET', SECRET);
  mocks.webhookEvent.findMany.mockResolvedValueOnce([{ id: 'evt_old' }]);
  mocks.webhookEvent.deleteMany.mockResolvedValueOnce({ count: 1 });
  const before = Date.now();
  const response = await GET(authorized());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.webhookEvents).toEqual({ deleted: 1, complete: true });
  expect(body.auditEvents).toEqual({ deleted: 0, complete: true });
  const webhookQuery = mocks.webhookEvent.findMany.mock.calls[0][0] as ExpiredQuery;
  expect(ageInDays(webhookQuery, before)).toBe(30);
  expect(webhookQuery.orderBy).toEqual({ createdAt: 'asc' });
  expect(mocks.webhookEvent.deleteMany).toHaveBeenCalledWith({
    where: { id: { in: ['evt_old'] } },
  });
  const auditQuery = mocks.auditEvent.findMany.mock.calls[0][0] as ExpiredQuery;
  expect(ageInDays(auditQuery, before)).toBe(400);
  expect(mocks.auditEvent.deleteMany).not.toHaveBeenCalled();
  expect(mocks.completeAbandonedClasses).toHaveBeenCalledOnce();
});

it('honours a longer AUDIT_RETENTION_DAYS', async () => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('AUDIT_RETENTION_DAYS', '730');
  const before = Date.now();
  await GET(authorized());
  const auditQuery = mocks.auditEvent.findMany.mock.calls[0][0] as ExpiredQuery;
  expect(ageInDays(auditQuery, before)).toBe(730);
});
