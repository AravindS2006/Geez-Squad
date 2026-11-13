import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
const fixture = vi.hoisted(() => ({
  studioRoleGrant: { findUnique: vi.fn() },
  studioMember: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  membership: { findUnique: vi.fn() },
  memberTerm: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: fixture }));
import { participation, requireParticipation, linkAcceptedMember } from '../src/lib/member-access';
beforeEach(() => {
  vi.resetAllMocks();
});
describe('studio participation', () => {
  // Real-database coverage of every reason: tests/class-poll-queries.test.ts.
  it('requires accepted access as well as a stable linked member', async () => {
    // The accepted Membership is a relation filter: a member without one is not found.
    fixture.studioMember.findFirst.mockResolvedValue(null);
    expect(await participation('studio', 'client', '2026-10-22')).toEqual({
      allowed: false,
      reason: 'Accept your studio request to participate.',
    });
    expect(fixture.studioMember.findFirst.mock.calls[0][0].where).toEqual({
      studioId: 'studio',
      userId: 'client',
      user: { memberships: { some: { studioId: 'studio' } } },
    });
    // A revoked trainee grant is final even with a member and membership.
    fixture.studioMember.findFirst.mockResolvedValue({ status: 'active', _count: { terms: 1 } });
    fixture.studioRoleGrant.findUnique.mockResolvedValue({ status: 'revoked' });
    expect((await participation('studio', 'client')).allowed).toBe(false);
    // A grant the caller already read is used instead of a second read.
    fixture.studioRoleGrant.findUnique.mockClear();
    expect((await participation('studio', 'client', undefined, undefined, null)).allowed).toBe(
      true,
    );
    expect(fixture.studioRoleGrant.findUnique).not.toHaveBeenCalled();
  });
  it('allows a valid term regardless of unpaid balance and checks inclusive dates', async () => {
    fixture.studioMember.findFirst.mockResolvedValue({ status: 'active', _count: { terms: 1 } });
    fixture.studioRoleGrant.findUnique.mockResolvedValue(null);
    expect((await participation('studio', 'client', '2026-10-22')).allowed).toBe(true);
    expect(fixture.studioMember.findFirst.mock.calls[0][0].select._count.select.terms).toEqual({
      where: {
        studioId: 'studio',
        status: 'active',
        startsOn: { lte: '2026-10-22' },
        endsOn: { gte: '2026-10-22' },
      },
    });
  });
  it('rejects paused members and expired/missing terms with an actionable code', async () => {
    fixture.studioMember.findFirst.mockResolvedValue({ status: 'paused', _count: { terms: 1 } });
    await expect(requireParticipation('studio', 'client')).rejects.toMatchObject({
      status: 403,
      code: 'MEMBERSHIP_REQUIRED',
    });
    fixture.studioMember.findFirst.mockResolvedValue({ status: 'active', _count: { terms: 0 } });
    expect((await participation('studio', 'client')).allowed).toBe(false);
  });
  it('never relinks an account to a different record when its contact email changes', async () => {
    const linked = { id: 'original', userId: 'client', email: 'new-contact@example.test' };
    fixture.studioMember.findUnique.mockResolvedValue(linked);
    expect(
      await linkAcceptedMember(fixture as never, 'studio', {
        id: 'client',
        email: 'account@example.test',
        name: 'Client',
        goal: '',
      }),
    ).toBe(linked);
    expect(fixture.studioMember.findMany).not.toHaveBeenCalled();
  });
});
