import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStudio } from '@/lib/studio-access';
import { ApiError, requireUser, readJson, safeError, rateLimit } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { writeMetrics } from '@/lib/metrics-write';
export const GET = loggedRoute('/api/studio-team/classes', async () => {
  try {
    const user = await requireUser();
    const { studio, admin } = await requireStudio(user.id, 'coach');
    const classes = await db.studioClass.findMany({
      where: { studioId: studio.id, ...(admin ? {} : { hostId: user.id }) },
      orderBy: { startsAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        location: true,
        startsAt: true,
        duration: true,
        status: true,
        bookings: {
          where: { status: 'booked' },
          select: { id: true, member: { select: { name: true } } },
        },
      },
    });
    return NextResponse.json({ classes }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return safeError(error);
  }
});
export const POST = loggedRoute('/api/studio-team/classes', async (request) => {
  try {
    const user = await requireUser();
    const data = z
      .object({ classId: z.string().min(1).max(100), action: z.enum(['complete', 'cancel']) })
      .strict()
      .parse(await readJson(request));
    await rateLimit(user.id, 'hosted-classes', 20);
    await writeMetrics(
      () =>
        db.$transaction(
          async (tx) => {
            const item = await tx.studioClass.findUnique({ where: { id: data.classId } });
            if (!item) throw new ApiError(404, 'Class not found.');
            const { admin } = await requireStudio(user.id, 'coach', item.studioId, tx);
            if (!admin && item.hostId !== user.id)
              throw new ApiError(404, 'This class is not hosted by you.');
            if (item.status !== 'scheduled')
              throw new ApiError(409, 'The class status has changed.');
            if (data.action === 'complete' && item.startsAt > new Date())
              throw new ApiError(409, 'A future class cannot be completed.');
            await tx.studioClass.update({
              where: { id: item.id },
              data: { status: data.action === 'complete' ? 'completed' : 'cancelled' },
            });
            if (data.action === 'cancel') {
              const bookings = await tx.studioBooking.findMany({
                where: { classId: item.id, status: 'booked' },
              });
              await tx.studioBooking.updateMany({
                where: { classId: item.id, status: 'booked' },
                data: { status: 'cancelled' },
              });
              for (const b of bookings)
                await tx.auditEvent.create({
                  data: { actorId: user.id, action: 'booking.classCancelled', targetId: b.id },
                });
            }
            await tx.auditEvent.create({
              data: { actorId: user.id, action: `hostedClass.${data.action}`, targetId: item.id },
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
