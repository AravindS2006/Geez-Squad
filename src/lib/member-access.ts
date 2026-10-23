import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './security';
import { studioToday } from './studio-operations';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { existingVideoRoomName } from './room-identity';
import { errorContext, logEvent } from './logger';
type Store = Pick<
  Prisma.TransactionClient,
  'studioMember' | 'membership' | 'memberTerm' | 'studioRoleGrant'
>;
export async function participation(
  studioId: string,
  userId: string,
  date = studioToday(),
  store: Store = db,
) {
  const member = await store.studioMember.findUnique({
    where: { studioId_userId: { studioId, userId } },
  });
  const accepted = await store.membership.findUnique({
    where: { studioId_userId: { studioId, userId } },
  });
  const grant = await store.studioRoleGrant.findUnique({
    where: { studioId_userId_role: { studioId, userId, role: 'trainee' } },
  });
  if (!member || !accepted || (grant && grant.status !== 'active'))
    return { allowed: false, reason: 'Accept your studio request to participate.' };
  if (member.status !== 'active')
    return {
      allowed: false,
      reason: 'Your studio membership is paused or archived. Contact your coach.',
    };
  const term = await store.memberTerm.findFirst({
    where: {
      studioId,
      memberId: member.id,
      status: 'active',
      startsOn: { lte: date },
      endsOn: { gte: date },
    },
  });
  return term
    ? { allowed: true, reason: '' }
    : {
        allowed: false,
        reason: 'An active membership is required for this session. Contact your coach to renew.',
      };
}
export async function requireParticipation(
  studioId: string,
  userId: string,
  date?: string,
  store?: Store,
) {
  const result = await participation(studioId, userId, date, store);
  if (!result.allowed) throw new ApiError(403, result.reason, 'MEMBERSHIP_REQUIRED');
}
export async function linkAcceptedMember(
  tx: Prisma.TransactionClient,
  studioId: string,
  user: { id: string; name: string; email: string; goal: string },
) {
  const linked = await tx.studioMember.findUnique({
    where: { studioId_userId: { studioId, userId: user.id } },
  });
  if (linked) return linked;
  const matches = await tx.studioMember.findMany({
    where: { studioId, email: user.email.toLowerCase() },
  });
  if (matches.length > 1 || matches.some((m) => m.userId && m.userId !== user.id))
    throw new ApiError(
      409,
      'The studio must resolve a duplicate member record before linking this account.',
    );
  return matches.length
    ? tx.studioMember.update({ where: { id: matches[0].id }, data: { userId: user.id } })
    : tx.studioMember.create({
        data: {
          studioId,
          userId: user.id,
          name: user.name,
          email: user.email.toLowerCase(),
          goal: user.goal,
          joinedOn: studioToday(),
        },
      });
}
export async function requestMemberAccess(
  tx: Prisma.TransactionClient,
  member: { id: string; email: string; userId: string | null },
) {
  if (member.userId) return;
  if (!member.email) {
    await tx.studioJoinRequest.updateMany({
      where: { memberId: member.id },
      data: { status: 'withdrawn' },
    });
    return;
  }
  const previous = await tx.studioJoinRequest.findUnique({ where: { memberId: member.id } });
  if (previous?.status === 'pending' && previous.email === member.email) return;
  // Only an explicit resend can override a client's decline.
  if (
    previous &&
    ['declined', 'withdrawn'].includes(previous.status) &&
    previous.email === member.email
  )
    return;
  await tx.studioJoinRequest.upsert({
    where: { memberId: member.id },
    create: { memberId: member.id, email: member.email },
    update: { email: member.email, status: 'pending' },
  });
}
/** Database decisions commit first; polling retries failed RTC cleanup. */
export async function revokeIneligibleParticipants(studioId: string, onlyUserId?: string) {
  try {
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET)
      return;
    const sessions = await db.classSession.findMany({
      where: {
        studioId,
        status: 'live',
        ...(onlyUserId ? { enrollments: { some: { userId: onlyUserId } } } : {}),
      },
      include: { enrollments: { select: { userId: true } } },
    });
    const service = new RoomServiceClient(
      process.env.LIVEKIT_URL.replace(/^ws/, 'http'),
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    );
    const date = studioToday();
    const [studio, grants, eligibleMembers] = await Promise.all([
      db.studio.findUniqueOrThrow({ where: { id: studioId }, select: { ownerId: true } }),
      db.studioRoleGrant.findMany({
        where: { studioId, status: 'active', role: { in: ['admin', 'coach'] } },
        select: { userId: true, role: true },
      }),
      db.studioMember.findMany({
        where: {
          studioId,
          status: 'active',
          userId: { in: [...new Set(sessions.flatMap((s) => s.enrollments.map((e) => e.userId)))] },
          terms: { some: { status: 'active', startsOn: { lte: date }, endsOn: { gte: date } } },
          user: {
            memberships: { some: { studioId } },
            NOT: {
              studioRoles: { some: { studioId, role: 'trainee', status: { not: 'active' } } },
            },
          },
        },
        select: { userId: true },
      }),
    ]);
    const eligible = new Set(eligibleMembers.map((m) => m.userId));
    for (const session of sessions) {
      const hostId = session.hostId ?? studio.ownerId;
      const managers = new Set([
        studio.ownerId,
        ...grants.filter((g) => g.role === 'admin' || g.userId === hostId).map((g) => g.userId),
      ]);
      const invalid = session.enrollments
        .filter((e) => !managers.has(e.userId) && !eligible.has(e.userId))
        .map((e) => e.userId);
      // Also revoke former hosts, including after a failed immediate removal.
      const connected = await service
        .listParticipants(existingVideoRoomName(session))
        .catch((error) => {
          if (error && typeof error === 'object' && 'status' in error && error.status === 404)
            return [];
          throw error;
        });
      for (const peer of connected) {
        if (managers.has(peer.identity)) continue;
        if (
          !session.enrollments.some((e) => e.userId === peer.identity) ||
          !eligible.has(peer.identity) ||
          peer.permission?.canPublishSources.includes(TrackSource.SCREEN_SHARE)
        )
          invalid.push(peer.identity);
      }
      if (!invalid.length) continue;
      await Promise.all(
        [...new Set(invalid)].map(async (identity) => {
          try {
            await service.removeParticipant(existingVideoRoomName(session), identity, {
              revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1),
            });
          } catch (error) {
            if (!(error && typeof error === 'object' && 'status' in error && error.status === 404))
              logEvent('error', 'participant_revocation_failed', {
                studioId,
                targetId: session.id,
                ...errorContext(error),
              });
          }
        }),
      );
    }
  } catch (error) {
    logEvent('error', 'participant_revocation_retry_needed', { studioId, ...errorContext(error) });
  }
}
export async function revokeStaffVideo(studioId: string, userId: string) {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET)
    return;
  const service = new RoomServiceClient(
    process.env.LIVEKIT_URL.replace(/^ws/, 'http'),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
  const sessions = await db.classSession.findMany({ where: { studioId, status: 'live' } });
  for (const session of sessions) {
    try {
      await service.removeParticipant(existingVideoRoomName(session), userId, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1),
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'status' in error && error.status === 404))
        logEvent('error', 'staff_video_revocation_failed', {
          studioId,
          targetId: session.id,
          ...errorContext(error),
        });
    }
  }
}
export async function reconcileBookings(tx: Prisma.TransactionClient, studioId: string) {
  const bookings = await tx.studioBooking.findMany({
    where: {
      status: 'booked',
      class: { studioId, status: 'scheduled', startsAt: { gt: new Date() } },
    },
    include: { class: true, member: { include: { terms: true } } },
  });
  const invalid = bookings.filter(
    (b) =>
      b.member.status !== 'active' ||
      !b.member.terms.some(
        (t) =>
          t.status === 'active' &&
          t.startsOn <= studioToday(b.class.startsAt) &&
          t.endsOn >= studioToday(b.class.startsAt),
      ),
  );
  if (invalid.length)
    await tx.studioBooking.updateMany({
      where: { id: { in: invalid.map((b) => b.id) } },
      data: { status: 'cancelled' },
    });
  for (const booking of invalid)
    await tx.auditEvent.create({
      data: {
        actorId: 'system:membership',
        action: 'booking.membershipInvalidated',
        targetId: booking.id,
      },
    });
  return invalid.length;
}
