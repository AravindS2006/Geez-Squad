import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStudio } from '@/lib/studio-access';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { writeMetrics } from '@/lib/metrics-write';
export const GET = loggedRoute('/api/studio-team/trainees', async () => {
  try {
    const user = await requireUser();
    const { studio } = await requireStudio(user.id, 'coach');
    const trainees = await db.studioMember.findMany({
      where: { studioId: studio.id, userId: null, primaryCoach: { coachId: user.id } },
      select: {
        id: true,
        name: true,
        goal: true,
        primaryCoach: { select: { assignedAt: true, note: true } },
      },
    });
    return NextResponse.json({ trainees }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return safeError(error);
  }
});
export const POST = loggedRoute('/api/studio-team/trainees', async (request) => {
  try {
    const user = await requireUser();
    const data = z
      .object({
        memberId: z.string().min(1).max(100),
        goal: z.string().trim().max(160),
        note: z.string().trim().max(2000),
      })
      .strict()
      .parse(await readJson(request));
    await rateLimit(user.id, 'in-person-coaching', 20);
    await writeMetrics(
      () =>
        db.$transaction(
          async (tx) => {
            const { studio } = await requireStudio(user.id, 'coach', undefined, tx);
            const member = await tx.studioMember.findFirst({
              where: {
                id: data.memberId,
                studioId: studio.id,
                userId: null,
                primaryCoach: { coachId: user.id },
              },
            });
            if (!member) throw new ApiError(404, 'This in-person trainee is not assigned to you.');
            await tx.studioMember.update({ where: { id: member.id }, data: { goal: data.goal } });
            await tx.primaryCoachAssignment.update({
              where: { memberId: member.id },
              data: { note: data.note },
            });
            await tx.auditEvent.create({
              data: { actorId: user.id, action: 'inPersonCoaching.update', targetId: member.id },
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
