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
  studioMember: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  membership: { findUnique: vi.fn() },
  memberTerm: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: fixture }));
import { participation, requireParticipation, linkAcceptedMember } from '../src/lib/member-access';
beforeEach(() => {
  vi.resetAllMocks();
});
describe('studio participation', () => {
  it('requires accepted access as well as a stable linked member', async () => {
    fixture.studioMember.findUnique.mockResolvedValue({ id: 'member', status: 'active' });
    fixture.membership.findUnique.mockResolvedValue(null);
    expect((await participation('studio', 'client')).allowed).toBe(false);
    expect(fixture.memberTerm.findFirst).not.toHaveBeenCalled();
  });
  it('allows a valid term regardless of unpaid balance and checks inclusive dates', async () => {
    fixture.studioMember.findUnique.mockResolvedValue({ id: 'member', status: 'active' });
    fixture.membership.findUnique.mockResolvedValue({ id: 'accepted' });
    fixture.memberTerm.findFirst.mockResolvedValue({ id: 'term', feePaise: 10000 });
    expect((await participation('studio', 'client', '2026-10-22')).allowed).toBe(true);
    expect(fixture.memberTerm.findFirst).toHaveBeenCalledWith({
      where: {
        studioId: 'studio',
        memberId: 'member',
        status: 'active',
        startsOn: { lte: '2026-10-22' },
        endsOn: { gte: '2026-10-22' },
      },
    });
  });
  it('rejects paused members and expired/missing terms with an actionable code', async () => {
    fixture.studioMember.findUnique.mockResolvedValue({ id: 'member', status: 'paused' });
    fixture.membership.findUnique.mockResolvedValue({ id: 'accepted' });
    await expect(requireParticipation('studio', 'client')).rejects.toMatchObject({
      status: 403,
      code: 'MEMBERSHIP_REQUIRED',
    });
    fixture.studioMember.findUnique.mockResolvedValue({ id: 'member', status: 'active' });
    fixture.memberTerm.findFirst.mockResolvedValue(null);
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
