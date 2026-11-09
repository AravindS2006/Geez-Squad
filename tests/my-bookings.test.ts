import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  members: vi.fn(),
  memberships: vi.fn(),
  grants: vi.fn(),
  classes: vi.fn(),
  studio: vi.fn(),
  audit: vi.fn(async () => []),
}));
vi.mock('@/lib/security', async () => {
  const { TestApiError, testSafeError } = await import('./route-mocks');
  return {
    ApiError: TestApiError,
    safeError: testSafeError,
    requireUser: async () => ({ id: 'trainee' }),
  };
});
vi.mock('@/lib/db', () => ({
  isSqliteDatabase: () => true,
  db: {
    studioMember: { findMany: fx.members },
    membership: { findMany: fx.memberships },
    studioRoleGrant: { findMany: fx.grants },
    studioClass: { findMany: fx.classes },
    studio: { findFirst: fx.studio },
    auditEvent: { findMany: fx.audit },
  },
}));
import { GET } from '../src/app/api/my-bookings/route';

const member = (studioId: string) => ({
  id: `m-${studioId}`,
  studioId,
  status: 'active',
  terms: [{ status: 'active', startsOn: '2026-01-01', endsOn: '2027-12-31' }],
  bookings: [],
  attendance: [],
});
const upcoming = (id: string, studioId: string) => ({
  id,
  studioId,
  title: id,
  trainer: 'Coach',
  location: 'Floor',
  startsAt: new Date(Date.now() + 86400000),
  duration: 45,
  capacity: 10,
  _count: { bookings: 2 },
});
beforeEach(() => {
  vi.clearAllMocks();
  fx.members.mockResolvedValue(['a', 'b', 'revoked', 'disconnected'].map(member));
  fx.memberships.mockResolvedValue([{ studioId: 'a' }, { studioId: 'b' }, { studioId: 'revoked' }]);
  fx.grants.mockResolvedValue([
    { studioId: 'b', status: 'active' },
    { studioId: 'revoked', status: 'revoked' },
  ]);
  fx.classes.mockResolvedValue([upcoming('a1', 'a'), upcoming('b1', 'b')]);
});
it('checks trainee access for every studio in batched queries and bounds the reads', async () => {
  const body = await (await GET(new Request('http://localhost/api/my-bookings'))).json();
  expect(fx.studio).not.toHaveBeenCalled();
  expect(fx.memberships).toHaveBeenCalledTimes(1);
  expect(fx.grants).toHaveBeenCalledTimes(1);
  expect(fx.classes).toHaveBeenCalledTimes(1);
  const classQuery = fx.classes.mock.calls[0][0] as {
    where: { studioId: { in: string[] } };
    take: number;
  };
  expect(classQuery.where.studioId.in.sort()).toEqual(['a', 'b']);
  expect(classQuery.take).toBe(200);
  const memberQuery = fx.members.mock.calls[0][0] as {
    take: number;
    include: { bookings: { take: number } };
  };
  expect(memberQuery.take).toBeGreaterThan(0);
  expect(memberQuery.include.bookings.take).toBeGreaterThan(0);
  expect(body.classes.map((c: { id: string; eligible: boolean }) => [c.id, c.eligible])).toEqual([
    ['a1', true],
    ['b1', true],
  ]);
});
