import 'server-only';
import type { Prisma } from '@prisma/client';
import { ApiError } from './security';
import { studioToday } from './studio-operations';

export async function changeBooking(
  tx: Prisma.TransactionClient,
  studioId: string,
  memberId: string,
  classId: string,
  status: 'booked' | 'cancelled',
  actorId: string,
) {
  const item = await tx.studioClass.findFirst({
    where: { id: classId, studioId },
    include: { bookings: { where: { status: 'booked' } } },
  });
  if (!item || item.status !== 'scheduled' || item.startsAt <= new Date())
    throw new ApiError(409, 'Only upcoming scheduled classes accept booking changes.');
  const member = await tx.studioMember.findFirst({ where: { id: memberId, studioId } });
  if (!member) throw new ApiError(404, 'This member is not available.');
  const previous = await tx.studioBooking.findUnique({
    where: { classId_memberId: { classId, memberId } },
  });
  if (previous?.status === status) return previous;
  if (status === 'booked') {
    const date = studioToday(item.startsAt);
    if (
      member.status !== 'active' ||
      !(await tx.memberTerm.findFirst({
        where: {
          studioId,
          memberId,
          status: 'active',
          startsOn: { lte: date },
          endsOn: { gte: date },
        },
      }))
    )
      throw new ApiError(
        409,
        'An active membership on the class date is required.',
        'MEMBERSHIP_REQUIRED',
      );
    if (item.bookings.length >= item.capacity)
      throw new ApiError(409, 'This class is full.', 'CLASS_FULL');
  } else if (!previous) throw new ApiError(404, 'Booking not found.');
  const booking = await tx.studioBooking.upsert({
    where: { classId_memberId: { classId, memberId } },
    create: { classId, memberId, status },
    update: { status },
  });
  await tx.auditEvent.create({
    data: { actorId, action: `booking.${status}`, targetId: booking.id },
  });
  return booking;
}
