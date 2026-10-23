import { grantTrainee, studioAccess } from '@/lib/studio-access';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { writeMetrics } from '@/lib/metrics-write';
export const GET = loggedRoute('/api/studio-join-requests', async () => {
  try {
    const user = await requireUser();
    if (!user.emailVerified)
      return NextResponse.json(
        { requests: [], verificationRequired: true },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    const requests = await db.studioJoinRequest.findMany({
      where: {
        email: user.email.toLowerCase(),
        status: 'pending',
        OR: [
          { targetUserId: null, member: { userId: null } },
          { targetUserId: user.id, member: { userId: user.id } },
        ],
        member: { status: { not: 'archived' } },
      },
      select: {
        id: true,
        createdAt: true,
        member: { select: { studio: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(
      {
        requests: requests.map((r) => ({
          id: r.id,
          studioName: r.member.studio.name,
          createdAt: r.createdAt,
        })),
        verificationRequired: false,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
});
export const POST = loggedRoute('/api/studio-join-requests', async (request) => {
  try {
    const user = await requireUser();
    if (!user.emailVerified)
      throw new ApiError(
        403,
        'Verify your email before accepting a studio request.',
        'EMAIL_VERIFICATION_REQUIRED',
      );
    if (user.role === 'unset')
      throw new ApiError(409, 'Complete your client profile before accepting a studio request.');
    const data = z
      .object({ requestId: z.string().min(1).max(100), action: z.enum(['accept', 'decline']) })
      .parse(await readJson(request));
    await rateLimit(user.id, 'studioJoin', 10);
    await writeMetrics(
      () =>
        db.$transaction(
          async (tx) => {
            const row = await tx.studioJoinRequest.findFirst({
              where: { id: data.requestId, email: user.email.toLowerCase() },
              include: { member: true },
            });
            if (!row || row.member.status === 'archived')
              throw new ApiError(404, 'This studio request is unavailable.');
            if (
              row.status === 'accepted' &&
              row.member.userId === user.id &&
              data.action === 'accept'
            )
              return;
            if (
              row.status !== 'pending' ||
              (row.targetUserId
                ? row.targetUserId !== user.id || row.member.userId !== user.id
                : row.member.userId !== null || row.member.email !== row.email)
            )
              throw new ApiError(409, 'This request has changed. Refresh to continue.');
            if (data.action === 'accept') {
              const access = await studioAccess(user.id, undefined, tx);
              if (access && access.studio.id !== row.member.studioId)
                throw new ApiError(409, 'Your account already belongs to another studio.');
              const memberships = await tx.membership.findMany({ where: { userId: user.id } });
              if (memberships.some((m) => m.studioId !== row.member.studioId))
                throw new ApiError(
                  409,
                  'You already belong to another studio. Contact your coach before transferring.',
                );
              const linked = await tx.studioMember.findUnique({
                where: { studioId_userId: { studioId: row.member.studioId, userId: user.id } },
              });
              if (linked && linked.id !== row.memberId)
                throw new ApiError(
                  409,
                  'Your account is already connected to another member record.',
                );
              await tx.studioMember.update({
                where: { id: row.memberId },
                data: { userId: user.id },
              });
              await grantTrainee(tx, row.member.studioId, user.id);
              await tx.membership.upsert({
                where: { studioId_userId: { studioId: row.member.studioId, userId: user.id } },
                create: { studioId: row.member.studioId, userId: user.id },
                update: {},
              });
            }
            await tx.studioJoinRequest.update({
              where: { id: row.id },
              data: { status: data.action === 'accept' ? 'accepted' : 'declined' },
            });
            await tx.auditEvent.create({
              data: {
                actorId: user.id,
                action: `studioJoin:${data.action}`,
                targetId: row.memberId,
              },
            });
          },
          { isolationLevel: 'Serializable' },
        ),
      process.env.DATABASE_PROVIDER !== 'postgresql',
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error);
  }
});
