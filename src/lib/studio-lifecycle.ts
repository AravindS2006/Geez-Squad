import 'server-only';
import type { Prisma, User } from '@prisma/client';
import { db, isSqliteDatabase } from './db';
import { emailPolicy } from './auth';
import { ApiError } from './security';
import { writeMetrics as writeTransaction } from './metrics-write';
import { studioAccess } from './studio-access';
import { completeLiveClass } from './class-completion';
import { verifyOwnPassword } from './account-deletion';
import { errorContext, logEvent } from './logger';
import { isPlatformOperator, reviewOutcome } from './studio-lifecycle-policy';

const serializable = { isolationLevel: 'Serializable' as const };
const transaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
  writeTransaction(() => db.$transaction(run, serializable), isSqliteDatabase());

type Actor = Pick<User, 'id' | 'email' | 'emailVerified' | 'role'>;

export function requireOperator(actor: Actor) {
  if (!isPlatformOperator(actor, process.env))
    throw new ApiError(403, 'Platform operator access is required.', 'OPERATOR_REQUIRED');
}

/** An account that already owns, staffs or trains in a studio cannot request another. */
async function assertNoStudio(tx: Prisma.TransactionClient, userId: string) {
  const [access, owned, membership] = await Promise.all([
    studioAccess(userId, undefined, tx),
    tx.studio.findUnique({ where: { ownerId: userId }, select: { id: true } }),
    tx.membership.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  if (access || owned || membership)
    throw new ApiError(409, 'Your account already belongs to a studio.', 'STUDIO_EXISTS');
}

const requestView = (r: {
  id: string;
  name: string;
  contactPhone: string;
  note: string;
  status: string;
  studioId: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}) => ({
  id: r.id,
  name: r.name,
  contactPhone: r.contactPhone,
  note: r.note,
  status: r.status,
  studioId: r.studioId,
  createdAt: r.createdAt.toISOString(),
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
});

export async function readStudioRequests(actor: Actor) {
  const operator = isPlatformOperator(actor, process.env);
  const [mine, pending] = await Promise.all([
    db.studioRequest.findFirst({ where: { userId: actor.id }, orderBy: { createdAt: 'desc' } }),
    operator
      ? db.studioRequest.findMany({
          where: { status: 'pending' },
          include: { user: { select: { name: true, email: true, emailVerified: true } } },
          orderBy: { createdAt: 'asc' },
          take: 50,
        })
      : [],
  ]);
  return {
    operator,
    mine: mine ? requestView(mine) : null,
    pending: pending.map((r) => ({
      ...requestView(r),
      requester: { name: r.user.name, email: r.user.email, emailVerified: r.user.emailVerified },
    })),
  };
}

export async function submitStudioRequest(
  actor: Actor,
  input: { name: string; contactPhone: string; note: string },
) {
  if (!actor.emailVerified)
    throw new ApiError(
      403,
      'Verify your email before requesting a studio.',
      'EMAIL_VERIFICATION_REQUIRED',
    );
  if (actor.role === 'unset') throw new ApiError(409, 'Finish setting up your profile first.');
  return transaction(async (tx) => {
    await assertNoStudio(tx, actor.id);
    if (await tx.studioRequest.findFirst({ where: { userId: actor.id, status: 'pending' } }))
      throw new ApiError(409, 'You already have a pending studio request.');
    const created = await tx.studioRequest.create({ data: { userId: actor.id, ...input } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: 'studio.requested', targetId: created.id },
    });
    return requestView(created);
  });
}

export async function withdrawStudioRequest(actor: Actor, requestId: string) {
  return transaction(async (tx) => {
    const changed = await tx.studioRequest.updateMany({
      where: { id: requestId, userId: actor.id, status: 'pending' },
      data: { status: 'withdrawn' },
    });
    if (!changed.count) throw new ApiError(404, 'No pending studio request was found.');
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: 'studio.requestWithdrawn', targetId: requestId },
    });
    return { ok: true };
  });
}

/**
 * Operator review. Approval creates the studio with the requester as owner and
 * first admin in the same transaction as the status change and audit event. The
 * status change is conditional on `pending`, so a double-click or concurrent
 * approval creates one studio; the repeat returns that studio's id.
 */
export async function reviewStudioRequest(
  operator: Actor,
  requestId: string,
  decision: 'approve' | 'reject',
) {
  requireOperator(operator);
  return transaction(async (tx) => {
    const request = await tx.studioRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { id: true, emailVerified: true } } },
    });
    if (!request) throw new ApiError(404, 'Studio request not found.');
    const outcome = reviewOutcome(request.status, decision);
    if (outcome === 'repeat') return { ok: true, repeated: true, studioId: request.studioId };
    if (outcome === 'conflict')
      throw new ApiError(409, `This request was already ${request.status}.`);
    const now = new Date();
    if (decision === 'reject') {
      const claimed = await tx.studioRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: { status: 'rejected', reviewedById: operator.id, reviewedAt: now },
      });
      if (!claimed.count) throw new ApiError(409, 'This request changed. Refresh and retry.');
      await tx.auditEvent.create({
        data: { actorId: operator.id, action: 'studio.requestRejected', targetId: request.id },
      });
      return { ok: true, repeated: false, studioId: null };
    }
    if (!request.user.emailVerified)
      throw new ApiError(409, 'The requester has not verified their email.');
    await assertNoStudio(tx, request.userId);
    const claimed = await tx.studioRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: { status: 'approved', reviewedById: operator.id, reviewedAt: now },
    });
    if (!claimed.count) throw new ApiError(409, 'This request changed. Refresh and retry.');
    const studio = await tx.studio.create({
      data: { name: request.name, phone: request.contactPhone, ownerId: request.userId },
    });
    await tx.studioRoleGrant.create({
      data: { studioId: studio.id, userId: request.userId, role: 'admin' },
    });
    await tx.studioRequest.update({ where: { id: request.id }, data: { studioId: studio.id } });
    await tx.auditEvent.create({
      data: {
        actorId: operator.id,
        action: 'studio.created',
        targetId: studio.id,
        detailsJson: { requestId: request.id, ownerId: request.userId },
      },
    });
    return { ok: true, repeated: false, studioId: studio.id };
  });
}

/**
 * People an owner may hand the studio to: anyone with current access to it
 * (the same rules as `studioAccess`), who owns no other studio and, when email
 * verification is enforced, has verified their address.
 */
async function transferCandidates(
  store: Prisma.TransactionClient,
  studioId: string,
  ownerId: string,
) {
  const [grants, memberships] = await Promise.all([
    store.studioRoleGrant.findMany({
      where: { studioId, userId: { not: ownerId } },
      select: { userId: true, role: true, status: true },
    }),
    store.membership.findMany({
      where: { studioId, userId: { not: ownerId } },
      select: { userId: true },
    }),
  ]);
  const active = (userId: string, role: string) =>
    grants.some((g) => g.userId === userId && g.role === role && g.status === 'active');
  const revokedTrainee = new Set(
    grants.filter((g) => g.role === 'trainee' && g.status !== 'active').map((g) => g.userId),
  );
  const roles = new Map<string, 'admin' | 'coach' | 'trainee'>();
  for (const g of grants)
    if (g.status === 'active' && (g.role === 'admin' || g.role === 'coach'))
      roles.set(g.userId, active(g.userId, 'admin') ? 'admin' : 'coach');
  for (const m of memberships)
    if (!roles.has(m.userId) && !revokedTrainee.has(m.userId)) roles.set(m.userId, 'trainee');
  if (!roles.size) return [];
  const users = await store.user.findMany({
    where: {
      id: { in: [...roles.keys()] },
      studio: { is: null },
      ...(emailPolicy.requireVerification ? { emailVerified: true } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return users.map((u) => ({ id: u.id, name: u.name, role: roles.get(u.id)! }));
}

export async function readOwnership(actor: Actor) {
  const studio = await db.studio.findFirst({
    where: { ownerId: actor.id, status: 'active' },
    select: { id: true, name: true },
  });
  if (!studio) return { owner: false as const };
  return {
    owner: true as const,
    studio,
    candidates: await transferCandidates(db, studio.id, actor.id),
  };
}

export async function transferOwnership(actor: Actor, targetId: string, password: string) {
  await verifyOwnPassword(actor.id, password);
  const result = await transaction(async (tx) => {
    const studio = await tx.studio.findFirst({ where: { ownerId: actor.id, status: 'active' } });
    if (!studio) throw new ApiError(404, 'You do not own an open studio.');
    if (targetId === actor.id) throw new ApiError(400, 'Choose another person.');
    // Same studio scope as the candidate list; a foreign or removed user is a 404.
    if (
      !(await transferCandidates(tx, studio.id, actor.id)).some((c) => c.id === targetId) ||
      !(await studioAccess(targetId, studio.id, tx))
    )
      throw new ApiError(404, 'Choose a current admin, coach or member of your studio.');
    // Classes that fell back to the owner as host keep their current host.
    await tx.classSession.updateMany({
      where: { studioId: studio.id, hostId: null, status: { in: ['scheduled', 'live'] } },
      data: { hostId: actor.id },
    });
    await tx.studioClass.updateMany({
      where: { studioId: studio.id, hostId: null, status: 'scheduled' },
      data: { hostId: actor.id },
    });
    const moved = await tx.studio.updateMany({
      where: { id: studio.id, ownerId: actor.id, status: 'active' },
      data: { ownerId: targetId },
    });
    if (!moved.count) throw new ApiError(409, 'The studio changed. Refresh and retry.');
    // The new owner is the admin of record; the former owner stays an admin
    // until the new owner changes that in Team.
    for (const userId of [targetId, actor.id])
      await tx.studioRoleGrant.upsert({
        where: { studioId_userId_role: { studioId: studio.id, userId, role: 'admin' } },
        create: { studioId: studio.id, userId, role: 'admin' },
        update: { status: 'active' },
      });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: 'studio.ownershipTransferred',
        targetId: studio.id,
        detailsJson: { from: actor.id, to: targetId },
      },
    });
    return { studioId: studio.id };
  });
  logEvent('info', 'studio_ownership_transferred', { targetId: result.studioId });
  return { ok: true };
}

/**
 * Owner closes the studio. In one transaction: mark it closed, revoke every
 * role grant, remove trainee connections (so former trainees can join another
 * studio), end coach assignments into history, cancel scheduled classes and
 * pending invitations or requests, and audit. The member register, terms,
 * payments, attendance and workout records are retained. Live classes then end
 * through the shared completion path, which also closes their video rooms.
 * Repeating the call after a partial room failure retries only that step.
 */
export async function closeStudio(actor: Actor, password: string) {
  await verifyOwnPassword(actor.id, password);
  const now = new Date();
  const closed = await transaction(async (tx) => {
    const studio = await tx.studio.findUnique({ where: { ownerId: actor.id } });
    if (!studio) throw new ApiError(404, 'You do not own a studio.');
    const live = await tx.classSession.findMany({
      where: { studioId: studio.id, status: 'live' },
      select: { id: true, videoRoomName: true },
    });
    if (studio.status === 'closed') return { studioId: studio.id, live, repeated: true };
    const changed = await tx.studio.updateMany({
      where: { id: studio.id, ownerId: actor.id, status: 'active' },
      data: { status: 'closed', closedAt: now, closedById: actor.id },
    });
    if (!changed.count) throw new ApiError(409, 'The studio changed. Refresh and retry.');
    await tx.studioRoleGrant.updateMany({
      where: { studioId: studio.id, status: 'active' },
      data: { status: 'revoked' },
    });
    await tx.membership.deleteMany({ where: { studioId: studio.id } });
    await tx.planAssignment.deleteMany({ where: { studioId: studio.id } });
    const assignments = await tx.primaryCoachAssignment.findMany({
      where: { member: { studioId: studio.id } },
    });
    if (assignments.length)
      await tx.coachAssignmentHistory.createMany({
        data: assignments.map((a) => ({
          memberId: a.memberId,
          studioId: studio.id,
          coachId: a.coachId,
          assignedAt: a.assignedAt,
          note: 'Studio closed',
        })),
      });
    await tx.primaryCoachAssignment.deleteMany({ where: { member: { studioId: studio.id } } });
    await tx.invitation.deleteMany({ where: { studioId: studio.id, consumedAt: null } });
    await tx.studioTeamRequest.updateMany({
      where: { studioId: studio.id, status: 'pending' },
      data: { status: 'withdrawn' },
    });
    await tx.studioJoinRequest.updateMany({
      where: { member: { studioId: studio.id }, status: 'pending' },
      data: { status: 'withdrawn' },
    });
    const cancelled = await tx.classSession.updateMany({
      where: { studioId: studio.id, status: 'scheduled' },
      data: {
        status: 'cancelled',
        endedAt: now,
        revision: { increment: 1 },
        controlSequence: { increment: 1 },
      },
    });
    await tx.studioBooking.updateMany({
      where: { class: { studioId: studio.id, status: 'scheduled' }, status: 'booked' },
      data: { status: 'cancelled' },
    });
    await tx.studioClass.updateMany({
      where: { studioId: studio.id, status: 'scheduled' },
      data: { status: 'cancelled' },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: 'studio.closed',
        targetId: studio.id,
        detailsJson: { cancelledClasses: cancelled.count, liveClasses: live.length },
      },
    });
    return { studioId: studio.id, live, repeated: false };
  });
  let roomsLeftOpen = 0;
  for (const item of closed.live) {
    try {
      const ended = await completeLiveClass(item, { actorId: actor.id, action: 'studioClosed' });
      if (ended.roomClosed === false) roomsLeftOpen++;
    } catch (error) {
      // The studio is closed and nobody can manage the class; the retention
      // job's abandoned-class sweep completes it if this attempt failed.
      roomsLeftOpen++;
      logEvent('warn', 'studio_close_class_end_failed', {
        targetId: item.id,
        ...errorContext(error),
      });
    }
  }
  logEvent('info', 'studio_closed', {
    targetId: closed.studioId,
    repeated: closed.repeated,
    liveClasses: closed.live.length,
    roomsLeftOpen,
  });
  return { ok: true, repeated: closed.repeated, roomsLeftOpen };
}
