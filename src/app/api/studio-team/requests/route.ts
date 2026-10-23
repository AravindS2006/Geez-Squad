import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { studioAccess } from '@/lib/studio-access';
import { writeMetrics } from '@/lib/metrics-write';
export const GET = loggedRoute('/api/studio-team/requests', async () => {
  try {
    const user = await requireUser();
    const requests = user.emailVerified
      ? await db.studioTeamRequest.findMany({
          where: {
            email: user.email.toLowerCase(),
            status: 'pending',
            expiresAt: { gt: new Date() },
          },
          select: { id: true, expiresAt: true, studio: { select: { name: true } } },
        })
      : [];
    return NextResponse.json(
      {
        requests: requests.map((r) => ({
          id: r.id,
          studioName: r.studio.name,
          expiresAt: r.expiresAt,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
});
export const POST = loggedRoute('/api/studio-team/requests', async (request) => {
  try {
    const user = await requireUser();
    if (!user.emailVerified)
      throw new ApiError(
        403,
        'Verify your mailbox before accepting a coach request.',
        'EMAIL_VERIFICATION_REQUIRED',
      );
    if (user.role === 'unset') throw new ApiError(409, 'Complete your personal profile first.');
    const data = z
      .object({ requestId: z.string().min(1).max(100), action: z.enum(['accept', 'decline']) })
      .strict()
      .parse(await readJson(request));
    await rateLimit(user.id, 'team-requests', 10);
    await writeMetrics(
      () =>
        db.$transaction(
          async (tx) => {
            const row = await tx.studioTeamRequest.findFirst({
              where: { id: data.requestId, email: user.email.toLowerCase(), role: 'coach' },
            });
            if (!row) throw new ApiError(404, 'Coach request not found.');
            const current = await tx.studioRoleGrant.findUnique({
              where: {
                studioId_userId_role: { studioId: row.studioId, userId: user.id, role: 'coach' },
              },
            });
            if (
              row.status === 'accepted' &&
              data.action === 'accept' &&
              current?.status === 'active'
            )
              return;
            if (row.status !== 'pending' || row.expiresAt <= new Date())
              throw new ApiError(409, 'This request is expired or has changed.');
            if (data.action === 'accept') {
              const access = await studioAccess(user.id, undefined, tx);
              if (access && access.studio.id !== row.studioId)
                throw new ApiError(409, 'Your account already belongs to another studio.');
              await tx.studioRoleGrant.upsert({
                where: {
                  studioId_userId_role: { studioId: row.studioId, userId: user.id, role: 'coach' },
                },
                create: { studioId: row.studioId, userId: user.id, role: 'coach' },
                update: { status: 'active', grantedAt: new Date() },
              });
            }
            await tx.studioTeamRequest.update({
              where: { id: row.id },
              data: { status: data.action === 'accept' ? 'accepted' : 'declined' },
            });
            await tx.auditEvent.create({
              data: { actorId: user.id, action: `teamRequest.${data.action}`, targetId: row.id },
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
