import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './security';
import {
  addDays,
  studioToday,
  type OperationsCommand,
  type OperationsData,
} from './studio-operations';
import { writeMetrics } from './metrics-write';
import {
  requestMemberAccess,
  reconcileBookings,
  revokeIneligibleParticipants,
} from './member-access';
import { logEvent } from './logger';
import { requestContext } from './request-log';

export async function readOperations(studioId: string): Promise<OperationsData> {
  const [studio, members, offers, terms, payments, attendance, enquiries, staff, studioClasses] =
    await Promise.all([
      db.studio.findUniqueOrThrow({
        where: { id: studioId },
        select: { name: true, address: true, phone: true, hours: true },
      }),
      db.studioMember.findMany({
        where: { studioId },
        include: { joinRequest: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      db.membershipOffer.findMany({ where: { studioId }, orderBy: { pricePaise: 'asc' } }),
      db.memberTerm.findMany({ where: { studioId }, orderBy: { endsOn: 'desc' } }),
      db.studioPayment.findMany({ where: { studioId }, orderBy: { paidOn: 'desc' } }),
      db.studioAttendance.findMany({ where: { studioId }, orderBy: { date: 'desc' } }),
      db.studioEnquiry.findMany({ where: { studioId }, orderBy: { followUpOn: 'asc' } }),
      db.studioStaff.findMany({ where: { studioId }, orderBy: { name: 'asc' } }),
      db.studioClass.findMany({
        where: { studioId },
        include: { bookings: true },
        orderBy: { startsAt: 'asc' },
      }),
    ]);
  return {
    studio,
    members: members.map(({ joinRequest, ...member }) => ({
      ...member,
      accessStatus: member.userId
        ? 'connected'
        : !member.email
          ? 'no_email'
          : (joinRequest?.status ?? 'withdrawn'),
    })),
    offers,
    terms,
    payments,
    attendance,
    enquiries,
    staff,
    studioClasses: studioClasses.map((s) => ({ ...s, startsAt: s.startsAt.toISOString() })),
  };
}

export async function mutateOperations(studioId: string, actorId: string, c: OperationsCommand) {
  const result = await writeMetrics(
    () =>
      db.$transaction(
        async (tx) => {
          let targetId = 'id' in c && c.id ? c.id : studioId;
          const assertOwned = async (
            model:
              'studioMember' | 'membershipOffer' | 'memberTerm' | 'studioEnquiry' | 'studioStaff',
            id: string,
          ) => {
            // Every lookup is scoped before any modification; foreign IDs are never accepted.
            const row = await (tx[model] as typeof tx.studioMember).findFirst({
              where: { id, studioId },
            });
            if (!row) throw new ApiError(404, 'This studio record is not available.');
          };
          switch (c.action) {
            case 'memberAccess': {
              const member = await tx.studioMember.findFirst({
                where: { id: c.memberId, studioId },
              });
              if (!member || member.userId || !member.email || member.status === 'archived')
                throw new ApiError(409, 'Choose an unlinked member with an email address.');
              await tx.studioJoinRequest.upsert({
                where: { memberId: member.id },
                create: {
                  memberId: member.id,
                  email: member.email,
                  status: c.operation === 'resend' ? 'pending' : 'withdrawn',
                },
                update: {
                  email: member.email,
                  status: c.operation === 'resend' ? 'pending' : 'withdrawn',
                },
              });
              targetId = member.id;
              break;
            }
            case 'studioClass': {
              const { action, id, startsAt, ...fields } = c;
              const existing = id
                ? await tx.studioClass.findFirst({
                    where: { id, studioId },
                    include: { bookings: { where: { status: 'booked' } } },
                  })
                : null;
              if (id && !existing) throw new ApiError(404, 'This class is not available.');
              if (existing && existing.status !== 'scheduled')
                throw new ApiError(409, 'Completed or cancelled classes cannot be edited.');
              if (fields.status === 'scheduled' && Date.parse(startsAt) <= Date.now())
                throw new ApiError(400, 'Schedule a class in the future.');
              if (fields.status === 'completed' && Date.parse(startsAt) > Date.now())
                throw new ApiError(400, 'A future class cannot be completed.');
              if (existing && fields.capacity < existing.bookings.length)
                throw new ApiError(409, 'Capacity cannot be smaller than the booked roster.');
              if (
                existing &&
                existing.bookings.length &&
                existing.startsAt.toISOString() !== startsAt
              ) {
                const date = studioToday(new Date(startsAt));
                for (const b of existing.bookings) {
                  if (
                    !(await tx.memberTerm.findFirst({
                      where: {
                        studioId,
                        memberId: b.memberId,
                        status: 'active',
                        startsOn: { lte: date },
                        endsOn: { gte: date },
                      },
                    }))
                  )
                    throw new ApiError(
                      409,
                      'A booked member has no membership on the new class date. Cancel their booking before rescheduling.',
                    );
                }
              }
              targetId = (
                id
                  ? await tx.studioClass.update({
                      where: { id },
                      data: { ...fields, startsAt: new Date(startsAt) },
                    })
                  : await tx.studioClass.create({
                      data: { ...fields, startsAt: new Date(startsAt), studioId },
                    })
              ).id;
              break;
            }
            case 'booking': {
              const item = await tx.studioClass.findFirst({
                where: { id: c.classId, studioId },
                include: { bookings: { where: { status: 'booked' } } },
              });
              if (!item || item.status !== 'scheduled' || item.startsAt <= new Date())
                throw new ApiError(409, 'Only upcoming scheduled classes accept booking changes.');
              const member = await tx.studioMember.findFirst({
                where: { id: c.memberId, studioId },
              });
              if (!member) throw new ApiError(404, 'This member is not available.');
              if (c.status === 'booked') {
                const date = studioToday(item.startsAt);
                if (
                  member.status !== 'active' ||
                  !(await tx.memberTerm.findFirst({
                    where: {
                      studioId,
                      memberId: member.id,
                      status: 'active',
                      startsOn: { lte: date },
                      endsOn: { gte: date },
                    },
                  }))
                )
                  throw new ApiError(409, 'An active membership on the class date is required.');
                if (
                  !item.bookings.some((b) => b.memberId === member.id) &&
                  item.bookings.length >= item.capacity
                )
                  throw new ApiError(409, 'This class is full.');
              }
              targetId = (
                await tx.studioBooking.upsert({
                  where: { classId_memberId: { classId: item.id, memberId: member.id } },
                  create: { classId: item.id, memberId: member.id, status: c.status },
                  update: { status: c.status },
                })
              ).id;
              break;
            }
            case 'member': {
              const { action, id, offerId, startsOn = studioToday(), ...fields } = c;
              if (id) await assertOwned('studioMember', id);
              if (
                fields.email &&
                (await tx.studioMember.findFirst({
                  where: { studioId, email: fields.email, ...(id ? { id: { not: id } } : {}) },
                }))
              )
                throw new ApiError(409, 'A member with this email already exists.');
              const member = id
                ? await tx.studioMember.update({ where: { id }, data: fields })
                : await tx.studioMember.create({ data: { ...fields, studioId } });
              targetId = member.id;
              if (offerId) {
                const offer = await tx.membershipOffer.findFirst({
                  where: { id: offerId, studioId, active: true },
                });
                if (!offer || member.status !== 'active')
                  throw new ApiError(400, 'Choose an active member and an available plan.');
                const endsOn = addDays(startsOn, offer.durationDays - 1);
                if (
                  await tx.memberTerm.findFirst({
                    where: {
                      memberId: member.id,
                      status: { not: 'cancelled' },
                      startsOn: { lte: endsOn },
                      endsOn: { gte: startsOn },
                    },
                  })
                )
                  throw new ApiError(409, 'This membership overlaps an existing term.');
                await tx.memberTerm.create({
                  data: {
                    studioId,
                    memberId: member.id,
                    offerId,
                    startsOn,
                    endsOn,
                    planName: offer.name,
                    feePaise: offer.pricePaise,
                  },
                });
              }
              await requestMemberAccess(tx, member);
              if (member.status === 'archived')
                await tx.studioJoinRequest.updateMany({
                  where: { memberId: member.id },
                  data: { status: 'withdrawn' },
                });
              break;
            }
            case 'offer': {
              const { action, id, ...fields } = c;
              if (id) await assertOwned('membershipOffer', id);
              targetId = (
                id
                  ? await tx.membershipOffer.update({ where: { id }, data: fields })
                  : await tx.membershipOffer.create({ data: { ...fields, studioId } })
              ).id;
              break;
            }
            case 'term': {
              const [member, offer] = await Promise.all([
                tx.studioMember.findFirst({
                  where: { id: c.memberId, studioId, status: 'active' },
                }),
                tx.membershipOffer.findFirst({ where: { id: c.offerId, studioId, active: true } }),
              ]);
              if (!member || !offer)
                throw new ApiError(400, 'Choose an active member and an available plan.');
              const endsOn = addDays(c.startsOn, offer.durationDays - 1);
              if (
                await tx.memberTerm.findFirst({
                  where: {
                    studioId,
                    memberId: member.id,
                    status: { not: 'cancelled' },
                    startsOn: { lte: endsOn },
                    endsOn: { gte: c.startsOn },
                  },
                })
              )
                throw new ApiError(
                  409,
                  'This membership overlaps an existing term. Choose a later start date.',
                );
              targetId = (
                await tx.memberTerm.create({
                  data: {
                    studioId,
                    memberId: member.id,
                    offerId: offer.id,
                    planName: offer.name,
                    feePaise: offer.pricePaise,
                    startsOn: c.startsOn,
                    endsOn,
                  },
                })
              ).id;
              break;
            }
            case 'cancelTerm': {
              await assertOwned('memberTerm', c.id);
              if (await tx.studioPayment.count({ where: { termId: c.id } }))
                throw new ApiError(
                  409,
                  'A paid term cannot be cancelled. Keep it as part of the payment history.',
                );
              await tx.memberTerm.update({ where: { id: c.id }, data: { status: 'cancelled' } });
              break;
            }
            case 'payment': {
              const previous = await tx.studioPayment.findUnique({ where: { id: c.id } });
              if (previous) {
                if (
                  previous.studioId !== studioId ||
                  previous.termId !== c.termId ||
                  previous.amountPaise !== c.amountPaise ||
                  previous.paidOn !== c.paidOn ||
                  previous.method !== c.method ||
                  previous.reference !== c.reference
                )
                  throw new ApiError(409, 'This payment request has already been used.');
                return { ok: true, id: previous.id };
              }
              const term = await tx.memberTerm.findFirst({
                where: { id: c.termId, studioId, status: { not: 'cancelled' } },
                include: { payments: true },
              });
              if (!term) throw new ApiError(404, 'This membership is not available.');
              const paid = term.payments.reduce((sum, p) => sum + p.amountPaise, 0);
              if (c.amountPaise > term.feePaise - paid)
                throw new ApiError(409, 'Payment exceeds the outstanding membership balance.');
              if (c.paidOn > studioToday())
                throw new ApiError(400, 'Payment date cannot be in the future.');
              const { action, ...fields } = c;
              await tx.studioPayment.create({ data: { ...fields, studioId } });
              break;
            }
            case 'attendance': {
              if (c.date > studioToday())
                throw new ApiError(400, 'Attendance cannot be recorded in the future.');
              const member = await tx.studioMember.findFirst({
                where: { id: c.memberId, studioId, status: 'active' },
              });
              const term = await tx.memberTerm.findFirst({
                where: {
                  memberId: c.memberId,
                  studioId,
                  status: 'active',
                  startsOn: { lte: c.date },
                  endsOn: { gte: c.date },
                },
              });
              if (!member || !term)
                throw new ApiError(409, 'An active membership is required to check in.');
              targetId = (
                await tx.studioAttendance.upsert({
                  where: { memberId_date: { memberId: c.memberId, date: c.date } },
                  create: { memberId: c.memberId, date: c.date, studioId },
                  update: {},
                })
              ).id;
              break;
            }
            case 'enquiry': {
              const { action, id, ...fields } = c;
              if (id) await assertOwned('studioEnquiry', id);
              targetId = (
                id
                  ? await tx.studioEnquiry.update({ where: { id }, data: fields })
                  : await tx.studioEnquiry.create({ data: { ...fields, studioId } })
              ).id;
              break;
            }
            case 'staff': {
              const { action, id, ...fields } = c;
              if (id) await assertOwned('studioStaff', id);
              targetId = (
                id
                  ? await tx.studioStaff.update({ where: { id }, data: fields })
                  : await tx.studioStaff.create({ data: { ...fields, studioId } })
              ).id;
              break;
            }
            case 'details': {
              const { action, ...fields } = c;
              await tx.studio.update({ where: { id: studioId }, data: fields });
              break;
            }
          }
          const releasedBookings =
            c.action === 'member' || c.action === 'cancelTerm'
              ? await reconcileBookings(tx, studioId)
              : 0;
          await tx.auditEvent.create({ data: { actorId, action: `studio.${c.action}`, targetId } });
          return { ok: true, id: targetId, releasedBookings };
        },
        { isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel },
      ),
    process.env.DATABASE_PROVIDER !== 'postgresql',
  );
  if (c.action === 'member' || c.action === 'cancelTerm')
    await revokeIneligibleParticipants(studioId);
  logEvent('info', 'studio_operation', {
    ...requestContext.getStore(),
    action: c.action,
    studioId,
    actorId,
    targetId: result.id,
  });
  return result;
}
