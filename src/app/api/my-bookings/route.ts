import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, isSqliteDatabase } from '@/lib/db';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { changeBooking } from '@/lib/studio-bookings';
import { writeMetrics } from '@/lib/metrics-write';
import { studioAccess, traineeStudioIds } from '@/lib/studio-access';
import { studioToday } from '@/lib/studio-operations';
const MAX_STUDIOS = 20,
  MAX_TERMS = 50,
  MAX_BOOKINGS = 200,
  MAX_HISTORY = 200,
  MAX_CLASSES_PER_STUDIO = 100;
export const GET = loggedRoute('/api/my-bookings', async () => {
  try {
    const user = await requireUser();
    const members = await db.studioMember.findMany({
      where: { userId: user.id },
      include: {
        terms: { orderBy: { endsOn: 'desc' }, take: MAX_TERMS },
        // Newest classes first keeps every upcoming booking within the limit.
        bookings: {
          include: { class: true },
          orderBy: [{ class: { startsAt: 'desc' } }, { id: 'desc' }],
          take: MAX_BOOKINGS,
        },
        attendance: { orderBy: { date: 'desc' }, take: 100 },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_STUDIOS,
    });
    const ownBookings = members.flatMap((m) => m.bookings);
    const history = await db.auditEvent.findMany({
      where: { targetId: { in: ownBookings.map((b) => b.id) }, action: { startsWith: 'booking.' } },
      select: { id: true, targetId: true, action: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
    });
    const traineeStudios = await traineeStudioIds(
      user.id,
      members.map((m) => m.studioId),
    );
    const available = traineeStudios.size
      ? await db.studioClass.findMany({
          where: {
            studioId: { in: [...traineeStudios] },
            status: 'scheduled',
            startsAt: { gt: new Date() },
          },
          include: { _count: { select: { bookings: { where: { status: 'booked' } } } } },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: MAX_CLASSES_PER_STUDIO * traineeStudios.size,
        })
      : [];
    const perStudio = new Map<string, number>();
    const classes = [];
    for (const item of available) {
      const member = members.find((m) => m.studioId === item.studioId);
      const shown = perStudio.get(item.studioId) ?? 0;
      if (!member || shown >= MAX_CLASSES_PER_STUDIO) continue;
      perStudio.set(item.studioId, shown + 1);
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
          member.terms.some((t) => t.status === 'active' && t.startsOn <= date && t.endsOn >= date),
      });
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
      isSqliteDatabase(),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error);
  }
});
