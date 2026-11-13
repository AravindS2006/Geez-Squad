import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './security';

export type AccessStore = Pick<
  Prisma.TransactionClient,
  'studio' | 'studioRoleGrant' | 'studioMember' | 'membership' | 'primaryCoachAssignment'
>;
export async function studioAccess(userId: string, studioId?: string, store: AccessStore = db) {
  const studio = await store.studio.findFirst({
    where: {
      ...(studioId ? { id: studioId } : {}),
      // A closed studio grants nobody access, its former owner included.
      status: 'active',
      OR: [
        { ownerId: userId },
        { roleGrants: { some: { userId, status: 'active', role: { in: ['admin', 'coach'] } } } },
        {
          memberships: { some: { userId } },
          NOT: { roleGrants: { some: { userId, role: 'trainee', status: { not: 'active' } } } },
        },
      ],
    },
    include: { roleGrants: { where: { userId } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!studio) return null;
  const admin =
    studio.ownerId === userId ||
    studio.roleGrants.some((g) => g.role === 'admin' && g.status === 'active');
  const coach = admin || studio.roleGrants.some((g) => g.role === 'coach' && g.status === 'active');
  const membership = await store.membership.findUnique({
    where: { studioId_userId: { studioId: studio.id, userId } },
  });
  const traineeGrant = studio.roleGrants.find((g) => g.role === 'trainee');
  // Legacy membership writes remain readable during cutover, but a revoked grant is final.
  const trainee = !!membership && (!traineeGrant || traineeGrant.status === 'active');
  if (!admin && !coach && !trainee) return null;
  return {
    studio,
    admin,
    coach,
    trainee,
    role: admin ? ('admin' as const) : coach ? ('coach' as const) : ('trainee' as const),
  };
}
/**
 * Batched form of `studioAccess(...).trainee` for every linked studio: a connected
 * membership whose trainee grant, when present, is still active.
 */
export async function traineeStudioIds(
  userId: string,
  studioIds: string[],
  store: AccessStore = db,
) {
  if (!studioIds.length) return new Set<string>();
  const [memberships, grants] = await Promise.all([
    store.membership.findMany({
      where: { userId, studioId: { in: studioIds } },
      select: { studioId: true },
    }),
    store.studioRoleGrant.findMany({
      where: { userId, role: 'trainee', studioId: { in: studioIds } },
      select: { studioId: true, status: true },
    }),
  ]);
  const revoked = new Set(grants.filter((g) => g.status !== 'active').map((g) => g.studioId));
  return new Set(memberships.map((m) => m.studioId).filter((id) => !revoked.has(id)));
}
export async function requireStudio(
  userId: string,
  permission: 'admin' | 'coach',
  studioId?: string,
  store?: AccessStore,
) {
  const access = await studioAccess(userId, studioId, store);
  if (!access?.[permission])
    throw new ApiError(
      403,
      permission === 'admin'
        ? 'Studio admin access is required.'
        : 'An active studio coaching role is required.',
      'STUDIO_ACCESS_REQUIRED',
    );
  return access;
}
export async function requireTraineeAccess(
  actorId: string,
  studioId: string,
  userId: string,
  store: AccessStore = db,
) {
  const access = await requireStudio(actorId, 'coach', studioId, store);
  const member = await store.studioMember.findUnique({
    where: { studioId_userId: { studioId, userId } },
    include: { primaryCoach: true },
  });
  const traineeGrant = await store.studioRoleGrant.findUnique({
    where: { studioId_userId_role: { studioId, userId, role: 'trainee' } },
  });
  if (
    !member ||
    (traineeGrant && traineeGrant.status !== 'active') ||
    !(await store.membership.findUnique({ where: { studioId_userId: { studioId, userId } } })) ||
    (!access.admin && member.primaryCoach?.coachId !== actorId)
  )
    throw new ApiError(404, 'This trainee is not assigned to you.');
  return { access, member, since: access.admin ? null : member.primaryCoach!.assignedAt };
}
export type ClassAccessGrant = { userId: string; role: string; status: string };
/**
 * One read for everything class permissions need: the actor's own grants in the
 * class's studio (any role or status, so a revoked trainee grant is visible too) and
 * the studio's active admins (presenters).
 */
export function classAccessGrants(
  studioId: string,
  userId: string,
  store: Pick<AccessStore, 'studioRoleGrant'> = db,
): Promise<ClassAccessGrant[]> {
  return store.studioRoleGrant.findMany({
    where: { studioId, OR: [{ userId }, { role: 'admin', status: 'active' }] },
    select: { userId: true, role: true, status: true },
  });
}
/**
 * Same result as `classPermissionView(item, userId, studioAccess(userId, studioId), admins)`:
 * class management only needs the staff half of `studioAccess` (owner, active admin or
 * active coach grant in this studio); trainee status never grants it.
 */
export function classPermissionsFromGrants(
  item: {
    studioId: string;
    hostId: string | null;
    studio: { ownerId: string; status?: string };
  },
  userId: string,
  grants: ClassAccessGrant[],
) {
  // A closed studio grants no staff access, matching `studioAccess` (active studios only).
  const open = item.studio.status !== 'closed';
  const own = (role: string) =>
    open && grants.some((g) => g.userId === userId && g.role === role && g.status === 'active');
  const admin = (open && item.studio.ownerId === userId) || own('admin');
  const coach = admin || own('coach');
  return classPermissionView(
    item,
    userId,
    coach ? { studio: { id: item.studioId }, admin, coach } : null,
    [
      ...new Set(
        grants.filter((g) => g.role === 'admin' && g.status === 'active').map((g) => g.userId),
      ),
    ],
  );
}
export async function classPermissions(
  item: { studioId: string; hostId: string | null; studio: { ownerId: string } },
  userId: string,
) {
  return classPermissionsFromGrants(item, userId, await classAccessGrants(item.studioId, userId));
}
export function classPermissionView(
  item: { studioId: string; hostId: string | null; studio: { ownerId: string } },
  userId: string,
  access: { studio: { id: string }; admin: boolean; coach: boolean } | null,
  adminIds: string[],
) {
  const hostId = item.hostId ?? item.studio.ownerId;
  const canManage =
    access?.studio.id === item.studioId && (access.admin || (access.coach && hostId === userId));
  return {
    canManage,
    hostId,
    presenterIds: [...new Set([hostId, item.studio.ownerId, ...adminIds])],
  };
}
export async function grantTrainee(tx: Prisma.TransactionClient, studioId: string, userId: string) {
  await tx.studioRoleGrant.upsert({
    where: { studioId_userId_role: { studioId, userId, role: 'trainee' } },
    create: { studioId, userId, role: 'trainee' },
    update: { status: 'active', grantedAt: new Date() },
  });
}
