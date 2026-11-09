import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({ ApiError: class extends Error {} }));
const fx = vi.hoisted(() => {
  const list = () => ({ findMany: vi.fn(async () => []) });
  return {
    studio: { findUniqueOrThrow: vi.fn(async () => ({ name: 'S' })) },
    studioMember: list(),
    membershipOffer: list(),
    memberTerm: list(),
    studioPayment: { ...list(), groupBy: vi.fn(async () => []) },
    studioAttendance: list(),
    studioEnquiry: list(),
    studioStaff: list(),
    studioClass: list(),
    membership: list(),
    user: list(),
  };
});
vi.mock('../src/lib/db', () => ({ db: fx, isSqliteDatabase: () => true }));
import {
  OPERATIONS_WINDOWS,
  readOperations,
  readPaymentHistory,
} from '../src/lib/studio-operations-server';

const now = new Date('2026-11-09T06:30:00Z'); // 2026-11-09 in Asia/Kolkata
type Args = { where: Record<string, unknown>; take?: number };
const args = (mock: { mock: { calls: unknown[][] } }, i = 0) => mock.mock.calls[i][0] as Args;
beforeEach(() => vi.clearAllMocks());
describe('bounded studio operations snapshot', () => {
  it('windows attendance, classes and terms while keeping balances exact', async () => {
    fx.memberTerm.findMany.mockResolvedValueOnce([
      { id: 'old-paid', feePaise: 1000 },
      { id: 'old-due', feePaise: 1000 },
    ] as never);
    fx.studioPayment.groupBy.mockResolvedValueOnce([
      { termId: 'old-paid', _sum: { amountPaise: 1000 } },
      { termId: 'old-due', _sum: { amountPaise: 400 } },
    ] as never);
    await readOperations('studio', now);
    expect(args(fx.studioAttendance.findMany).where).toEqual({
      studioId: 'studio',
      date: { gte: '2026-08-11' },
    });
    const classes = args(fx.studioClass.findMany);
    expect(classes.take).toBe(OPERATIONS_WINDOWS.maxClasses);
    expect(classes.where.startsAt).toEqual({ gte: new Date(now.getTime() - 30 * 86400000) });
    // The second term query is the snapshot; old settled terms are left out.
    const terms = args(fx.memberTerm.findMany, 1).where;
    expect(terms).toEqual({
      studioId: 'studio',
      OR: [
        { endsOn: { gte: '2025-11-09' } },
        { id: { in: ['old-due'] } },
        { payments: { some: { paidOn: { gte: '2026-04-23' } } } },
      ],
    });
    // Payments are fetched for exactly the returned terms, so outstanding() stays exact.
    expect(args(fx.studioPayment.findMany).where).toEqual({ studioId: 'studio', term: terms });
  });
  it('pages the full payment history with a keyset cursor', async () => {
    fx.studioPayment.findMany.mockResolvedValueOnce(
      Array.from({ length: OPERATIONS_WINDOWS.paymentPage + 1 }, (_, i) => ({
        id: `p${i}`,
        paidOn: '2024-01-01',
      })) as never,
    );
    const first = await readPaymentHistory('studio', null);
    expect(first.payments).toHaveLength(OPERATIONS_WINDOWS.paymentPage);
    expect(first.nextCursor).not.toBeNull();
    await readPaymentHistory('studio', first.nextCursor);
    expect(args(fx.studioPayment.findMany, 1).where).toEqual({
      AND: [
        { studioId: 'studio' },
        {
          OR: [
            { paidOn: { lt: '2024-01-01' } },
            { paidOn: '2024-01-01', id: { lt: `p${OPERATIONS_WINDOWS.paymentPage - 1}` } },
          ],
        },
      ],
    });
    await expect(readPaymentHistory('studio', 'not-a-cursor')).rejects.toThrow();
  });
});
