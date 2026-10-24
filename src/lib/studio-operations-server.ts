import { changeBooking } from './studio-bookings';
import { sendMail } from './mail';
import { requireStudio } from './studio-access';
import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './security';
import {
  addDays,
  studioToday,
  classOverlap,
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
        include: {
          joinRequest: { select: { status: true } },
          primaryCoach: { select: { coachId: true, assignedAt: true } },
        },
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
  const connections = await db.membership.findMany({
    where: {
      studioId,
      user: {
        NOT: { studioRoles: { some: { studioId, role: 'trainee', status: { not: 'active' } } } },
      },
    },
    select: { userId: true },
  });
  return {
    studio,
    coaches: await db.user.findMany({
      where: {
        OR: [
          { studio: { id: studioId } },
          {
            studioRoles: { some: { studioId, status: 'active', role: { in: ['admin', 'coach'] } } },
          },
        ],
      },
      select: { id: true, name: true },
    }),
    members: members.map(({ joinRequest, ...member }) => ({
      ...member,
      accessStatus:
        member.userId && connections.some((m) => m.userId === member.userId)
          ? 'connected'
          : member.userId
            ? joinRequest?.status === 'pending'
              ? 'pending_restore'
              : 'disconnected'
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
          await requireStudio(actorId, 'admin', studioId, tx);
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
              if (!member || member.status === 'archived')
                throw new ApiError(409, 'Choose an available member.');
              const linked = member.userId
                ? await tx.user.findUnique({ where: { id: member.userId } })
                : null;
              const connected = member.userId
                ? await tx.membership.findUnique({
                    where: { studioId_userId: { studioId, userId: member.userId } },
                  })
                : null;
              const traineeGrant = member.userId
                ? await tx.studioRoleGrant.findUnique({
                    where: {
                      studioId_userId_role: { studioId, userId: member.userId, role: 'trainee' },
                    },
                  })
                : null;
              if (connected && (!traineeGrant || traineeGrant.status === 'active'))
                throw new ApiError(409, 'This member is already connected.');
              const email = linked?.email ?? member.email;
              if (!email) throw new ApiError(409, 'Add an email before sending a setup request.');
              await tx.studioJoinRequest.upsert({
                where: { memberId: member.id },
                create: {
                  memberId: member.id,
                  email,
                  targetUserId: member.userId,
                  status: c.operation === 'withdraw' ? 'withdrawn' : 'pending',
                },
                update: {
                  email,
                  targetUserId: member.userId,
                  status: c.operation === 'withdraw' ? 'withdrawn' : 'pending',
                },
              });
              targetId = member.id;
              break;
            }
            case 'studioClass': {
              const { action, id, startsAt, hostId, ...fields } = c;
              const owner = await tx.studio.findUniqueOrThrow({ where: { id: studioId } });
              const selectedHost = hostId ?? owner.ownerId;
              await requireStudio(selectedHost, 'coach', studioId, tx);
              if (fields.status === 'scheduled') {
                const candidates = await tx.studioClass.findMany({
                  where: {
                    studioId,
                    status: 'scheduled',
                    ...(id ? { id: { not: id } } : {}),
                    startsAt: {
                      gt: new Date(Date.parse(startsAt) - 240 * 60000),
                      lt: new Date(Date.parse(startsAt) + fields.duration * 60000),
                    },
                  },
                });
                const collision = candidates.find(
                  (other) =>
                    classOverlap({ startsAt, duration: fields.duration }, other) &&
                    ((other.hostId ?? owner.ownerId) === selectedHost ||
                      other.location.trim().toLowerCase() === fields.location.trim().toLowerCase()),
                );
                const online = await tx.classSession.findMany({
                  where: {
                    studioId,
                    hostId: selectedHost,
                    status: { in: ['scheduled', 'live'] },
                    startsAt: {
                      gt: new Date(Date.parse(startsAt) - 240 * 60000),
                      lt: new Date(Date.parse(startsAt) + fields.duration * 60000),
                    },
                  },
                });
                if (
                  collision ||
                  online.some((other) =>
                    classOverlap({ startsAt, duration: fields.duration }, other),
                  )
                )
                  throw new ApiError(
                    409,
                    'This trainer or studio space already has an overlapping class. Choose another time, trainer, or space.',
                  );
              }
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
                      data: { ...fields, hostId: selectedHost, startsAt: new Date(startsAt) },
                    })
                  : await tx.studioClass.create({
                      data: {
                        ...fields,
                        hostId: selectedHost,
                        startsAt: new Date(startsAt),
                        studioId,
                      },
                    })
              ).id;
              if (fields.status === 'cancelled') {
                const bookings = await tx.studioBooking.findMany({
                  where: { classId: targetId, status: 'booked' },
                });
                await tx.studioBooking.updateMany({
                  where: { classId: targetId, status: 'booked' },
                  data: { status: 'cancelled' },
                });
                for (const booking of bookings)
                  await tx.auditEvent.create({
                    data: { actorId, action: 'booking.classCancelled', targetId: booking.id },
                  });
              }
              break;
            }
            case 'booking': {
              targetId = (
                await changeBooking(tx, studioId, c.memberId, c.classId, c.status, actorId)
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
            case 'removeAttendance': {
              await assertOwned('studioMember', c.memberId);
              const row = await tx.studioAttendance.findFirst({
                where: { studioId, memberId: c.memberId, date: c.date },
              });
              if (row) {
                targetId = row.id;
                await tx.studioAttendance.delete({ where: { id: row.id } });
              }
              // The audit reason contains no nutrition or camera information.
              await tx.auditEvent.create({
                data: {
                  actorId,
                  action: 'attendance.correction',
                  targetId: row?.id ?? c.memberId,
                  detailsJson: {
                    reason: c.reason,
                    memberId: c.memberId,
                    date: c.date,
                    removed: !!row,
                  },
                },
              });
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
  if (c.action === 'memberAccess' && c.operation !== 'withdraw') {
    const request = await db.studioJoinRequest.findUniqueOrThrow({
      where: { memberId: c.memberId },
      include: { member: { include: { studio: true } } },
    });
    try {
      await sendMail(
        request.email,
        `${request.member.studio.name}: connect your membership`,
        `Your studio membership is ready. Sign up or sign in using this email, verify your mailbox, and accept the studio request inside the app. Your membership and history remain saved if you connect later.\n\n${process.env.BETTER_AUTH_URL}/app`,
      );
    } catch {
      throw new ApiError(
        502,
        'Member and request saved. The setup email could not be delivered; use Send setup email to retry.',
        'EMAIL_DELIVERY_FAILED',
      );
    }
  }
  logEvent('info', 'studio_operation', {
    ...requestContext.getStore(),
    action: c.action,
    studioId,
    actorId,
    targetId: result.id,
  });
  return result;
}
