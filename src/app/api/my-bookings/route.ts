import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { changeBooking } from '@/lib/studio-bookings';
import { writeMetrics } from '@/lib/metrics-write';
import { studioAccess } from '@/lib/studio-access';
import { studioToday } from '@/lib/studio-operations';
export const GET = loggedRoute('/api/my-bookings', async () => {
  try {
    const user = await requireUser();
    const members = await db.studioMember.findMany({
      where: { userId: user.id },
      include: {
        terms: true,
        bookings: { include: { class: true } },
        attendance: { orderBy: { date: 'desc' }, take: 100 },
      },
    });
    const ownBookings = members.flatMap((m) => m.bookings);
    const history = await db.auditEvent.findMany({
      where: { targetId: { in: ownBookings.map((b) => b.id) }, action: { startsWith: 'booking.' } },
      select: { id: true, targetId: true, action: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const classes = [];
    for (const member of members) {
      const access = await studioAccess(user.id, member.studioId);
      if (!access?.trainee) continue;
      const available = await db.studioClass.findMany({
        where: { studioId: member.studioId, status: 'scheduled', startsAt: { gt: new Date() } },
        include: { _count: { select: { bookings: { where: { status: 'booked' } } } } },
        orderBy: { startsAt: 'asc' },
        take: 100,
      });
      for (const item of available) {
        const date = studioToday(item.startsAt);
        classes.push({
          id: item.id,
          title: item.title,
          trainer: item.trainer,
          location: item.location,
          startsAt: item.startsAt,
          duration: item.duration,
          seats: item.capacity - item._count.bookings,
          bookingStatus: member.bookings.find((b) => b.classId === item.id)?.status ?? null,
          eligible:
            member.status === 'active' &&
            member.terms.some(
              (t) => t.status === 'active' && t.startsOn <= date && t.endsOn >= date,
            ),
        });
      }
    }
    return NextResponse.json(
      {
        classes,
        history: history.map((h) => ({
          id: h.id,
          title: ownBookings.find((b) => b.id === h.targetId)!.class.title,
          action: h.action,
          createdAt: h.createdAt,
        })),
        bookings: members.flatMap((m) =>
          m.bookings.map((b) => ({
            id: b.id,
            classId: b.classId,
            title: b.class.title,
            startsAt: b.class.startsAt,
            classStatus: b.class.status,
            status: b.status,
          })),
        ),
        attendance: members.flatMap((m) => m.attendance.map((a) => ({ id: a.id, date: a.date }))),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
});
export const POST = loggedRoute('/api/my-bookings', async (request) => {
  try {
    const user = await requireUser();
    const data = z
      .object({ classId: z.string().min(1).max(100), action: z.enum(['book', 'cancel']) })
      .strict()
      .parse(await readJson(request));
    await rateLimit(user.id, 'my-bookings', 20);
    await writeMetrics(
      () =>
        db.$transaction(
          async (tx) => {
            const item = await tx.studioClass.findUnique({ where: { id: data.classId } });
            if (!item) throw new ApiError(404, 'Class not found.');
            const member = await tx.studioMember.findUnique({
              where: { studioId_userId: { studioId: item.studioId, userId: user.id } },
            });
            if (!member)
              throw new ApiError(404, 'Your member record is not connected to this class.');
            if (
              data.action === 'book' &&
              !(await studioAccess(user.id, item.studioId, tx))?.trainee
            )
              throw new ApiError(403, 'Accept your studio request before booking.');
            await changeBooking(
              tx,
              item.studioId,
              member.id,
              item.id,
              data.action === 'book' ? 'booked' : 'cancelled',
              user.id,
            );
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
