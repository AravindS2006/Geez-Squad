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
export async function classPermissions(
  item: { studioId: string; hostId: string | null; studio: { ownerId: string } },
  userId: string,
) {
  const access = await studioAccess(userId, item.studioId);
  const admins = await db.studioRoleGrant.findMany({
    where: { studioId: item.studioId, role: 'admin', status: 'active' },
    select: { userId: true },
  });
  return classPermissionView(
    item,
    userId,
    access,
    admins.map((a) => a.userId),
  );
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
