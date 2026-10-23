import type { Prisma } from '@prisma/client';
import { loggedRoute } from '@/lib/request-log';
import {
  linkAcceptedMember,
  requireParticipation,
  revokeIneligibleParticipants,
  reconcileBookings,
} from '@/lib/member-access';
import { logEvent } from '@/lib/logger';
import { requestContext } from '@/lib/request-log';
import { studioToday } from '@/lib/studio-operations';
import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commandSchema } from '@/lib/validation';
import { MAX_CLASS_CLIENTS } from '@/lib/class-policy';
import { sessionEditVersion } from '@/lib/session-management';
import { writeMetrics as writeTransaction } from '@/lib/metrics-write';
import { newVideoRoomName, existingVideoRoomName } from '@/lib/room-identity';
import {
  ApiError,
  requireUser,
  readJson,
  rateLimit,
  safeError,
  requireClass,
} from '@/lib/security';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import {
  studioAccess,
  requireTraineeAccess,
  classPermissions,
  grantTrainee,
  requireStudio,
} from '@/lib/studio-access';
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const data = commandSchema.parse(await readJson(request));
    logEvent('info', 'command_received', {
      ...requestContext.getStore(),
      action: data.action,
      actorId: user.id,
    });
    await rateLimit(user.id, 'command');
    const access = await studioAccess(user.id);
    const studio = access?.studio;
    const requireCoach = () => {
      if (!access?.coach || !studio)
        throw new ApiError(403, 'An active coaching role is required.');
      return studio;
    };
    const requireAdmin = () => {
      if (!access?.admin || !studio) throw new ApiError(403, 'Studio admin access is required.');
      return studio;
    };
    const assertPlan = async (id: string, store: Prisma.TransactionClient = db) => {
      const owned = requireCoach();
      const actor = await requireStudio(user.id, 'coach', owned.id, store);
      const plan = await store.workoutPlan.findFirst({ where: { id, studioId: owned.id } });
      if (!plan || (!actor.admin && plan.createdById !== user.id))
        throw new ApiError(404, 'This plan is not editable by you.');
      return plan;
    };
    const selectHost = async (hostId?: string) => {
      const owned = requireCoach();
      const selected = hostId ?? user.id;
      if (!access?.admin && selected !== user.id)
        throw new ApiError(403, 'Only admins can appoint another host.');
      await requireStudio(selected, 'coach', owned.id);
      return selected;
    };
    let result: Record<string, unknown> = { ok: true };
    switch (data.action) {
      case 'muteParticipants': {
        requireCoach();
        const item = await requireClass(data.id, user.id);
        const permissions = await classPermissions(item, user.id);
        if (!permissions.canManage)
          throw new ApiError(403, 'Only this session’s coach can mute participants.');
        if (item.status !== 'live')
          throw new ApiError(409, 'Start this class before managing microphones.');
        const allowed = new Set(item.enrollments.map((e) => e.userId));
        if (data.participantId && !allowed.has(data.participantId))
          throw new ApiError(400, 'Choose an enrolled trainee.');
        const service = videoService();
        if (!service) throw new ApiError(503, 'Live video is unavailable.');
        try {
          const participants = await service.listParticipants(existingVideoRoomName(item));
          await Promise.all(
            participants
              .filter(
                (p) =>
                  allowed.has(p.identity) &&
                  (!data.participantId || p.identity === data.participantId),
              )
              .flatMap((p) =>
                p.tracks
                  .filter((t) => t.source === TrackSource.MICROPHONE && !t.muted)
                  .map((t) =>
                    service.mutePublishedTrack(
                      existingVideoRoomName(item),
                      p.identity,
                      t.sid,
                      true,
                    ),
                  ),
              ),
          );
        } catch {
          throw new ApiError(502, 'Some microphones could not be muted. Retry shortly.');
        }
        await db.auditEvent.create({
          data: { actorId: user.id, action: 'muteParticipants', targetId: item.id },
        });
        break;
      }
      case 'onboard': {
        if (user.role !== 'unset') throw new ApiError(409, 'Your account is already set up.');
        await db.$transaction(
          async (tx) => {
            const updated = await tx.user.updateMany({
              where: { id: user.id, role: 'unset' },
              data: { name: data.name, role: data.role, consentVersion: 'adult-wellness-v1' },
            });
            if (!updated.count) throw new ApiError(409, 'Your account is already set up.');
          },
          { isolationLevel: 'Serializable' },
        );
        break;
      }
      case 'invite': {
        const owned = requireAdmin();
        const code = randomBytes(24).toString('base64url');
        await db.invitation.create({
          data: {
            studioId: owned.id,
            email: data.email,
            codeHash: createHash('sha256').update(code).digest('hex'),
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
        result = {
          ok: true,
          code,
          url: `${process.env.BETTER_AUTH_URL}/invite?code=${code}`,
          expiresInDays: 7,
        };
        break;
      }
      case 'acceptInvite': {
        if (user.role === 'unset')
          throw new ApiError(403, 'Set up a trainee account to accept this invitation.');
        const invitation = await db.invitation.findUnique({
          where: { codeHash: createHash('sha256').update(data.code).digest('hex') },
        });
        if (
          !invitation ||
          invitation.consumedAt ||
          invitation.expiresAt < new Date() ||
          invitation.email !== user.email.toLowerCase()
        )
          throw new ApiError(
            400,
            'This invitation is expired, used, or belongs to a different email.',
          );
        await db.$transaction(
          async (tx) => {
            const currentAccess = await studioAccess(user.id, undefined, tx);
            if (currentAccess && currentAccess.studio.id !== invitation.studioId)
              throw new ApiError(409, 'Your account already belongs to another studio.');
            if (await tx.membership.findFirst({ where: { userId: user.id } }))
              throw new ApiError(409, 'You already belong to a studio.');
            const claimed = await tx.invitation.updateMany({
              where: { id: invitation.id, consumedAt: null, expiresAt: { gt: new Date() } },
              data: { consumedAt: new Date() },
            });
            if (!claimed.count) throw new ApiError(409, 'This invitation has already been used.');
            await tx.membership.create({
              data: { studioId: invitation.studioId, userId: user.id },
            });
            await linkAcceptedMember(tx, invitation.studioId, user);
            await grantTrainee(tx, invitation.studioId, user.id);
            await tx.studioJoinRequest.updateMany({
              where: { email: user.email.toLowerCase(), member: { studioId: invitation.studioId } },
              data: { status: 'accepted' },
            });
          },
          { isolationLevel: 'Serializable' },
        );
        break;
      }
      case 'savePlan': {
        const owned = requireCoach();
        const plan = await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                await requireStudio(user.id, 'coach', owned.id, tx);
                if (data.id) await assertPlan(data.id, tx);
                const fields = {
                  name: data.name,
                  description: data.description,
                  blocks: data.blocks,
                };
                return data.id
                  ? tx.workoutPlan.update({ where: { id: data.id }, data: fields })
                  : tx.workoutPlan.create({
                      data: { ...fields, studioId: owned.id, createdById: user.id },
                    });
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        result.id = plan.id;
        break;
      }
      case 'assignPlan': {
        const owned = requireCoach();
        await requireTraineeAccess(user.id, owned.id, data.userId);
        await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                await requireTraineeAccess(user.id, owned.id, data.userId, tx);
                const member = await tx.membership.findUnique({
                  where: { studioId_userId: { studioId: owned.id, userId: data.userId } },
                });
                if (!member) throw new ApiError(404, 'Choose a client from your own studio.');
                if (data.planId === null) {
                  await tx.planAssignment.deleteMany({
                    where: { studioId: owned.id, userId: data.userId },
                  });
                } else {
                  const plan = await tx.workoutPlan.findFirst({
                    where: { id: data.planId, studioId: owned.id },
                  });
                  if (!plan) throw new ApiError(404, 'Choose a plan from your own studio.');
                  await tx.planAssignment.upsert({
                    where: { studioId_userId: { studioId: owned.id, userId: data.userId } },
                    create: { studioId: owned.id, userId: data.userId, planId: plan.id },
                    update: { planId: plan.id, assignedAt: new Date() },
                  });
                }
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        break;
      }
      case 'coachNote': {
        const owned = requireCoach();
        await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                const target = await requireTraineeAccess(user.id, owned.id, data.userId, tx);
                if (target.access.admin)
                  await tx.membership.update({
                    where: { studioId_userId: { studioId: owned.id, userId: data.userId } },
                    data: { coachNote: data.note },
                  });
                else
                  await tx.primaryCoachAssignment.update({
                    where: { memberId: target.member.id },
                    data: { note: data.note },
                  });
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        break;
      }
      case 'checkIn': {
        if (user.role === 'unset') throw new ApiError(403, 'Complete your personal profile first.');
        await rateLimit(user.id, 'check-in', 5);
        const { action: _action, ...values } = data;
        await db.checkIn.create({ data: { ...values, userId: user.id } });
        break;
      }
      case 'deletePlan': {
        const owned = requireCoach();
        await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                await assertPlan(data.id, tx);
                await tx.workoutPlan.delete({ where: { id: data.id } });
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        break;
      }
      case 'createClass': {
        const owned = requireCoach();
        const hostId = await selectHost(data.hostId);
        const item = await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                const actorAccess = await requireStudio(user.id, 'coach', owned.id, tx);
                await requireStudio(hostId, 'coach', owned.id, tx);
                const ids = data.includeAllClients
                  ? (
                      await tx.membership.findMany({
                        where: {
                          studioId: owned.id,
                          ...(!actorAccess.admin
                            ? {
                                user: {
                                  studioMembers: {
                                    some: {
                                      studioId: owned.id,
                                      primaryCoach: { coachId: user.id },
                                    },
                                  },
                                },
                              }
                            : {}),
                        },
                        select: { userId: true },
                      })
                    ).map((member) => member.userId)
                  : [...new Set(data.participantIds)];
                if (
                  (!data.includeAllClients && ids.length !== data.participantIds.length) ||
                  ids.length > MAX_CLASS_CLIENTS ||
                  (!data.includeAllClients && ids.length > data.capacity)
                )
                  throw new ApiError(400, 'Check the class capacity and participant list.');
                if (new Date(data.startsAt).getTime() < Date.now() - 60000)
                  throw new ApiError(400, 'Choose a future start time.');
                const members = await tx.membership.count({
                  where: { studioId: owned.id, userId: { in: ids } },
                });
                if (members !== ids.length)
                  throw new ApiError(403, 'Select clients from your own studio.');
                for (const clientId of ids)
                  if (!access?.admin) await requireTraineeAccess(user.id, owned.id, clientId, tx);
                for (const clientId of ids)
                  await requireParticipation(
                    owned.id,
                    clientId,
                    studioToday(new Date(data.startsAt)),
                    tx,
                  );
                const plan = data.planId
                  ? await tx.workoutPlan.findFirst({
                      where: { id: data.planId, studioId: owned.id },
                    })
                  : null;
                if (data.planId && !plan) throw new ApiError(404, 'Plan not found.');
                return tx.classSession.create({
                  data: {
                    studioId: owned.id,
                    hostId,
                    title: data.title,
                    startsAt: new Date(data.startsAt),
                    duration: data.duration,
                    capacity: Math.max(data.capacity, ids.length),
                    planId: plan?.id,
                    enrollments: { create: ids.map((userId) => ({ userId })) },
                  },
                });
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        result.id = item.id;
        break;
      }
      case 'updateClass': {
        const owned = requireCoach();
        const existingHost = await db.classSession.findUnique({ where: { id: data.id } });
        if (
          !existingHost ||
          existingHost.studioId !== owned.id ||
          (!access?.admin && existingHost.hostId !== user.id)
        )
          throw new ApiError(404, 'Session not available.');
        const hostId = await selectHost(data.hostId ?? existingHost.hostId ?? owned.ownerId);
        if (Date.parse(data.startsAt) < Date.now() - 60000)
          throw new ApiError(400, 'Choose a future start time.');
        await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                const actorAccess = await requireStudio(user.id, 'coach', owned.id, tx);
                await requireStudio(hostId, 'coach', owned.id, tx);
                const item = await tx.classSession.findFirst({
                  where: { id: data.id, studioId: owned.id },
                  include: { enrollments: true },
                });
                if (!item) throw new ApiError(404, 'Session not found.');
                if (item.status !== 'scheduled')
                  throw new ApiError(409, 'Only scheduled sessions can be edited.');
                if (sessionEditVersion(item) !== data.expectedVersion)
                  throw new ApiError(
                    409,
                    'This session changed while you were editing. Refresh and reopen it.',
                  );
                const members = await tx.membership.findMany({
                  where: { studioId: owned.id },
                  select: { userId: true },
                });
                const allowed = new Set(members.map((member) => member.userId));
                const assignedIds = actorAccess.admin
                  ? []
                  : (
                      await tx.studioMember.findMany({
                        where: { studioId: owned.id, primaryCoach: { coachId: user.id } },
                        select: { userId: true },
                      })
                    ).map((m) => m.userId);
                const ids = data.includeAllClients
                  ? members
                      .filter((m) => actorAccess.admin || assignedIds.includes(m.userId))
                      .map((m) => m.userId)
                  : [...new Set(data.participantIds)];
                if (
                  (!data.includeAllClients && ids.length !== data.participantIds.length) ||
                  ids.length > MAX_CLASS_CLIENTS ||
                  ids.length > data.capacity
                )
                  throw new ApiError(400, 'Check the session capacity and participant list.');
                for (const clientId of ids)
                  await requireParticipation(
                    owned.id,
                    clientId,
                    studioToday(new Date(data.startsAt)),
                    tx,
                  );
                if (ids.some((id) => !allowed.has(id)))
                  throw new ApiError(403, 'Select trainees from your own studio.');
                if (
                  data.planId &&
                  !(await tx.workoutPlan.findFirst({
                    where: { id: data.planId, studioId: owned.id },
                    select: { id: true },
                  }))
                )
                  throw new ApiError(404, 'Plan not found.');
                if (!access?.admin)
                  for (const clientId of ids.filter(
                    (id) => !item.enrollments.some((e) => e.userId === id),
                  ))
                    await requireTraineeAccess(user.id, owned.id, clientId, tx);
                const updated = await tx.classSession.updateMany({
                  where: {
                    id: item.id,
                    status: 'scheduled',
                    revision: item.revision,
                  },
                  data: {
                    title: data.title,
                    hostId,
                    startsAt: new Date(data.startsAt),
                    duration: data.duration,
                    capacity: data.capacity,
                    planId: data.planId,
                    revision: { increment: 1 },
                  },
                });
                if (!updated.count)
                  throw new ApiError(409, 'This session changed. Refresh and reopen it.');
                await tx.enrollment.deleteMany({
                  where: { classId: item.id, userId: { notIn: ids } },
                });
                const enrolled = new Set(item.enrollments.map((entry) => entry.userId));
                for (const userId of ids.filter((id) => !enrolled.has(id)))
                  await tx.enrollment.create({ data: { classId: item.id, userId } });
                await tx.auditEvent.create({
                  data: { actorId: user.id, action: 'updateClass', targetId: item.id },
                });
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        result.id = data.id;
        break;
      }
      case 'clientProfile': {
        const owned = requireCoach();
        await requireTraineeAccess(user.id, owned.id, data.userId);
        if (
          !(await db.membership.findUnique({
            where: { studioId_userId: { studioId: owned.id, userId: data.userId } },
          }))
        )
          throw new ApiError(404, 'Choose a trainee from your own studio.');
        const updated = await db.studioMember.updateMany({
          where: {
            studioId: owned.id,
            userId: data.userId,
            name: data.expectedName,
            goal: data.expectedGoal,
            user: { memberships: { some: { studioId: owned.id } } },
          },
          data: { name: data.name, goal: data.goal },
        });
        if (!updated.count)
          throw new ApiError(
            409,
            'This studio profile changed. Refresh and reopen it before saving.',
          );
        await db.auditEvent.create({
          data: { actorId: user.id, action: 'clientProfile', targetId: data.userId },
        });
        break;
      }
      case 'removeClient': {
        const owned = requireAdmin();
        await writeTransaction(
          () =>
            db.$transaction(
              async (tx) => {
                const member = await tx.membership.findUnique({
                  where: { studioId_userId: { studioId: owned.id, userId: data.userId } },
                  include: { user: { select: { email: true } } },
                });
                if (!member) throw new ApiError(404, 'Choose a trainee from your own studio.');
                const scheduled = await tx.enrollment.findMany({
                  where: {
                    userId: data.userId,
                    class: { studioId: owned.id, status: 'scheduled' },
                  },
                  select: { classId: true },
                });
                // Invalidate open editors and a concurrent start before changing the roster.
                const locked = await tx.classSession.updateMany({
                  where: {
                    id: { in: scheduled.map((entry) => entry.classId) },
                    status: 'scheduled',
                  },
                  data: { revision: { increment: 1 } },
                });
                if (locked.count !== scheduled.length)
                  throw new ApiError(
                    409,
                    'A session started during this change. Refresh and retry.',
                  );
                await tx.enrollment.deleteMany({
                  where: {
                    userId: data.userId,
                    class: { studioId: owned.id, status: 'scheduled' },
                  },
                });
                await tx.planAssignment.deleteMany({
                  where: { studioId: owned.id, userId: data.userId },
                });
                await tx.invitation.deleteMany({
                  where: {
                    studioId: owned.id,
                    email: member.user.email.toLowerCase(),
                    consumedAt: null,
                  },
                });
                await tx.membership.delete({ where: { id: member.id } });
                await tx.studioRoleGrant.updateMany({
                  where: { studioId: owned.id, userId: data.userId, role: 'trainee' },
                  data: { status: 'revoked' },
                });
                const previousAssignments = await tx.primaryCoachAssignment.findMany({
                  where: { member: { studioId: owned.id, userId: data.userId } },
                });
                for (const a of previousAssignments)
                  await tx.coachAssignmentHistory.create({
                    data: {
                      memberId: a.memberId,
                      studioId: owned.id,
                      coachId: a.coachId,
                      assignedAt: a.assignedAt,
                      note: a.note,
                    },
                  });
                await tx.primaryCoachAssignment.deleteMany({
                  where: { member: { studioId: owned.id, userId: data.userId } },
                });
                await tx.studioMember.updateMany({
                  where: { studioId: owned.id, userId: data.userId },
                  data: { status: 'paused' },
                });
                await reconcileBookings(tx, owned.id);
                await tx.studioJoinRequest.updateMany({
                  where: { member: { studioId: owned.id, userId: data.userId } },
                  data: { status: 'withdrawn' },
                });
                await tx.auditEvent.create({
                  data: { actorId: user.id, action: 'removeClient', targetId: data.userId },
                });
              },
              { isolationLevel: 'Serializable' },
            ),
          process.env.DATABASE_PROVIDER !== 'postgresql',
        );
        await revokeIneligibleParticipants(owned.id, data.userId);
        break;
      }
      case 'classControl': {
        requireCoach();
        const item = await requireClass(data.id, user.id);
        const permissions = await classPermissions(item, user.id);
        if (!permissions.canManage)
          throw new ApiError(403, 'Only this class coach can control it.');
        if (data.control === 'end' && item.status === 'completed') {
          await deleteRoom(existingVideoRoomName(item), [
            item.studio.ownerId,
            permissions.hostId,
            ...item.enrollments.map((e) => e.userId),
          ]);
          break;
        }
        const allowed =
          data.control === 'start' || data.control === 'cancel' ? 'scheduled' : 'live';
        if (item.status !== allowed)
          throw new ApiError(409, 'The session state has changed. Refresh and retry.');
        if (data.control === 'exercise' && !data.exercise)
          throw new ApiError(400, 'Choose an exercise.');
        if (data.control === 'start') await createRoom(item.id, MAX_CLASS_CLIENTS + 2);
        const change =
          data.control === 'start'
            ? {
                status: 'live',
                startedAt: new Date(),
                paused: false,
                videoRoomName: newVideoRoomName(item.id),
              }
            : data.control === 'end'
              ? { status: 'completed', endedAt: new Date(), paused: true }
              : data.control === 'cancel'
                ? { status: 'cancelled', endedAt: new Date() }
                : data.control === 'exercise'
                  ? { exercise: data.exercise, revision: { increment: 1 } }
                  : { paused: data.control === 'pause' };
        const updated = await db.classSession.updateMany({
          where: { id: item.id, status: allowed, revision: item.revision, hostId: item.hostId },
          data: change,
        });
        if (!updated.count)
          throw new ApiError(409, 'Another update was applied. Refresh and retry.');
        await db.auditEvent.create({
          data: { actorId: user.id, action: data.control, targetId: item.id },
        });
        if (data.control === 'end')
          await deleteRoom(existingVideoRoomName(item), [
            item.studio.ownerId,
            permissions.hostId,
            ...item.enrollments.map((e) => e.userId),
          ]);
        break;
      }
      case 'consent': {
        const item = await requireClass(data.id, user.id);
        const permissions = await classPermissions(item, user.id);
        if (!permissions.canManage) await requireParticipation(item.studioId, user.id);
        if (item.status !== 'live') throw new ApiError(409, 'This session is not live.');
        if (!permissions.canManage)
          await db.enrollment.updateMany({
            where: { classId: item.id, userId: user.id, consentAt: null },
            data: { consentAt: new Date() },
          });
        break;
      }
      case 'help': {
        const item = await requireClass(data.id, user.id);
        const permissions = await classPermissions(item, user.id);
        if (!permissions.canManage) await requireParticipation(item.studioId, user.id);
        if (item.status !== 'live') throw new ApiError(409, 'This session is not live.');
        const target = data.userId ?? user.id;
        if (target !== user.id && (!permissions.canManage || data.requested))
          throw new ApiError(403, 'Only the trainee can request help.');
        if (!item.enrollments.some((e) => e.userId === target))
          throw new ApiError(404, 'Participant not found.');
        await db.enrollment.update({
          where: { classId_userId: { classId: item.id, userId: target } },
          data: { helpRequested: data.requested },
        });
        break;
      }
      case 'message': {
        const item = await requireClass(data.id, user.id);
        const permissions = await classPermissions(item, user.id);
        if (!permissions.canManage) await requireParticipation(item.studioId, user.id);
        if (item.status !== 'live')
          throw new ApiError(409, 'Messages are available during a live class.');
        if (data.kind === 'cue' && !permissions.canManage)
          throw new ApiError(403, 'Only the coach can send form cues.');
        const target = data.recipientId;
        if (
          target &&
          target !== permissions.hostId &&
          target !== item.studio.ownerId &&
          !item.enrollments.some((e) => e.userId === target)
        )
          throw new ApiError(400, 'Recipient is not in this class.');
        if (
          !permissions.canManage &&
          target &&
          target !== permissions.hostId &&
          target !== item.studio.ownerId
        )
          throw new ApiError(403, 'Private trainee messages can only go to the coach.');
        await rateLimit(user.id, 'message', 20);
        await db.message.create({
          data: {
            classId: item.id,
            senderId: user.id,
            recipientId: target,
            text: data.text,
            kind: data.kind,
          },
        });
        break;
      }
      case 'profile':
        await db.user.update({
          where: { id: user.id },
          data: { name: data.name, goal: data.goal },
        });
        break;
    }
    return NextResponse.json(result);
  } catch (error) {
    return safeError(error);
  }
}
function videoService() {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET)
    return null;
  return new RoomServiceClient(
    process.env.LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://'),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
}
async function createRoom(id: string, maxParticipants: number) {
  const service = videoService();
  if (!service) return;
  try {
    await service.createRoom({
      name: newVideoRoomName(id),
      maxParticipants,
      // Preserve an idle room through the longest supported class and its reconnect window.
      emptyTimeout: 10800,
      departureTimeout: 10800,
    });
  } catch {
    throw new ApiError(
      502,
      'Live video could not be prepared. The class has not started; retry shortly.',
    );
  }
}
async function deleteRoom(roomName: string, identities: string[]) {
  const service = videoService();
  if (!service) return;
  const cutoff = BigInt(Math.floor(Date.now() / 1000) + 1);
  const revocations = await Promise.allSettled(
    identities.map((identity) =>
      service.removeParticipant(roomName, identity, { revokeTokenTs: cutoff }),
    ),
  );
  const revoked = revocations.every(
    (result) => result.status === 'fulfilled' || isRoomMissing(result.reason),
  );
  try {
    await service.deleteRoom(roomName);
  } catch (error) {
    if (isRoomMissing(error) && revoked) return;
    throw new ApiError(
      502,
      'The class ended, but video room cleanup failed. Retry End session to close the room.',
    );
  }
  if (!revoked)
    throw new ApiError(
      502,
      'The class ended and the room closed, but token revocation needs retry. Use End session again.',
    );
}
function isRoomMissing(error: unknown) {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 404;
}

export const POST = loggedRoute('/api/command', handlePOST);
