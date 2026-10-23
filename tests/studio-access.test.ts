import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
const fixture = vi.hoisted(() => ({
  studioRoleGrant: { findUnique: vi.fn(), findMany: vi.fn() },
  studio: { findFirst: vi.fn() },
  membership: { findUnique: vi.fn() },
  studioMember: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ db: fixture }));
import {
  studioAccess,
  requireStudio,
  requireTraineeAccess,
  classPermissions,
} from '../src/lib/studio-access';
beforeEach(() => {
  vi.resetAllMocks();
  fixture.studioRoleGrant.findMany.mockResolvedValue([]);
  fixture.membership.findUnique.mockResolvedValue(null);
});
describe('studio-scoped permissions', () => {
  it('protects owner admin access and never relies on global user roles', async () => {
    fixture.studio.findFirst.mockResolvedValue({ id: 'studio', ownerId: 'owner', roleGrants: [] });
    expect(await studioAccess('owner')).toMatchObject({
      admin: true,
      coach: true,
      trainee: false,
      role: 'admin',
    });
    expect(await studioAccess('directory-coach')).toBeNull();
    await expect(requireStudio('directory-coach', 'coach')).rejects.toMatchObject({ status: 403 });
  });
  it('allows explicit coaching and personal membership to coexist', async () => {
    fixture.studio.findFirst.mockResolvedValue({
      id: 'studio',
      ownerId: 'owner',
      roleGrants: [
        { role: 'coach', status: 'active' },
        { role: 'trainee', status: 'active' },
      ],
    });
    fixture.membership.findUnique.mockResolvedValue({ id: 'membership' });
    expect(await studioAccess('coach')).toMatchObject({ admin: false, coach: true, trainee: true });
    await expect(requireStudio('coach', 'admin')).rejects.toMatchObject({ status: 403 });
  });
  it('never revives revoked access from a stale legacy membership', async () => {
    fixture.studio.findFirst.mockResolvedValue({
      id: 'studio',
      ownerId: 'owner',
      roleGrants: [
        { role: 'coach', status: 'revoked' },
        { role: 'trainee', status: 'revoked' },
      ],
    });
    fixture.membership.findUnique.mockResolvedValue({ id: 'legacy' });
    expect(await studioAccess('former')).toBeNull();
  });
  it('requires the current primary assignment and exposes its visibility boundary', async () => {
    fixture.studio.findFirst.mockResolvedValue({
      id: 'studio',
      ownerId: 'owner',
      roleGrants: [{ role: 'coach', status: 'active' }],
    });
    fixture.membership.findUnique.mockResolvedValue({ id: 'membership' });
    const assignedAt = new Date('2026-10-23T05:00:00Z');
    fixture.studioMember.findUnique.mockResolvedValue({
      id: 'member',
      primaryCoach: { coachId: 'coach', assignedAt },
    });
    expect((await requireTraineeAccess('coach', 'studio', 'client')).since).toEqual(assignedAt);
    await expect(requireTraineeAccess('previous-coach', 'studio', 'client')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('group hosting grants session management without a primary assignment', async () => {
    fixture.studio.findFirst.mockResolvedValue({
      id: 'studio',
      ownerId: 'owner',
      roleGrants: [{ role: 'coach', status: 'active' }],
    });
    const item = { studioId: 'studio', hostId: 'coach', studio: { ownerId: 'owner' } };
    expect((await classPermissions(item, 'coach')).canManage).toBe(true);
    expect((await classPermissions(item, 'other-coach')).canManage).toBe(false);
    fixture.studio.findFirst.mockResolvedValue({
      id: 'studio',
      ownerId: 'owner',
      roleGrants: [{ role: 'coach', status: 'suspended' }],
    });
    expect((await classPermissions(item, 'coach')).canManage).toBe(false);
  });
});
