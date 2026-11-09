import 'server-only';
import { verifyPassword } from 'better-auth/crypto';
import { db, isSqliteDatabase } from './db';
import { ApiError } from './security';
import { writeMetrics } from './metrics-write';
import { revokeStaffVideo } from './member-access';
import { logEvent } from './logger';
import { requestContext } from './request-log';
import { deletionBlocker } from './account-deletion-policy';

/**
 * Self-service account erasure. The user's own records (profile, sign-in, sessions,
 * workouts, check-ins, nutrition, enrollments, messages) cascade with the user row.
 * Studio-owned records (member register, terms, payments, attendance, bookings) stay
 * with the studio and are unlinked from the account by the existing SetNull relation.
 * Studio owners and active subscribers are refused instead of silently cascading a
 * studio or orphaning a live payment subscription.
 */
export async function deleteOwnAccount(userId: string, password: string) {
  const credential = await db.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  });
  if (!credential?.password || !(await verifyPassword({ hash: credential.password, password })))
    throw new ApiError(403, 'The password is incorrect.', 'PASSWORD_INCORRECT');

  const studioIds = await writeMetrics(
    () =>
      db.$transaction(
        async (tx) => {
          const [ownedStudio, billing] = await Promise.all([
            tx.studio.findUnique({ where: { ownerId: userId }, select: { id: true } }),
            tx.billingSubscription.findUnique({ where: { userId }, select: { status: true } }),
          ]);
          const blocker = deletionBlocker({
            ownsStudio: !!ownedStudio,
            billingStatus: billing?.status,
          });
          if (blocker) throw new ApiError(409, blocker.message, blocker.code);

          const [memberships, grants, coachAssignments] = await Promise.all([
            tx.membership.findMany({ where: { userId }, select: { studioId: true } }),
            tx.studioRoleGrant.findMany({ where: { userId }, select: { studioId: true } }),
            tx.primaryCoachAssignment.findMany({
              where: { coachId: userId },
              include: { member: { select: { studioId: true } } },
            }),
          ]);
          // Members keep a record of who coached them; the assignment itself cascades.
          if (coachAssignments.length)
            await tx.coachAssignmentHistory.createMany({
              data: coachAssignments.map((a) => ({
                memberId: a.memberId,
                studioId: a.member.studioId,
                coachId: userId,
                assignedAt: a.assignedAt,
                note: 'Coach account deleted',
              })),
            });
          // Host IDs are plain strings; fall back to the studio owner for upcoming classes.
          await tx.classSession.updateMany({
            where: { hostId: userId, status: { in: ['scheduled', 'live'] } },
            data: { hostId: null },
          });
          await tx.studioClass.updateMany({
            where: { hostId: userId, status: 'scheduled' },
            data: { hostId: null },
          });
          await tx.studioJoinRequest.updateMany({
            where: { targetUserId: userId, status: 'pending' },
            data: { status: 'withdrawn', targetUserId: null },
          });
          await tx.auditEvent.create({
            data: { actorId: userId, action: 'account.deleted', targetId: userId },
          });
          await tx.user.delete({ where: { id: userId } });
          return [...new Set([...memberships, ...grants].map((m) => m.studioId))];
        },
        { isolationLevel: 'Serializable' },
      ),
    isSqliteDatabase(),
  );
  // Sessions are already gone, so token requests fail; also disconnect live rooms.
  for (const studioId of studioIds)
    await revokeStaffVideo(studioId, userId).catch(() => {
      logEvent('warn', 'account_deletion_video_revocation_retry', { studioId });
    });
  logEvent('info', 'account_deleted', { ...requestContext.getStore(), studios: studioIds.length });
}
