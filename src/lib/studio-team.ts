import 'server-only';
import { db } from './db';
import { ApiError } from './security';
import { requireStudio, studioAccess } from './studio-access';
import { writeMetrics } from './metrics-write';
import { sendMail } from './mail';
import { revokeStaffVideo } from './member-access';
import { z } from 'zod';
import { logEvent } from './logger';
import { requestContext } from './request-log';

const id = z.string().min(1).max(100);
export const teamCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('invite'),
      email: z
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
    })
    .strict(),
  z.object({ action: z.literal('withdraw'), requestId: id }).strict(),
  z
    .object({
      action: z.literal('status'),
      userId: id,
      status: z.enum(['active', 'suspended', 'revoked']),
    })
    .strict(),
  z.object({ action: z.literal('assign'), memberId: id, coachId: id.nullable() }).strict(),
]);
export async function readTeam(actorId: string) {
  const { studio } = await requireStudio(actorId, 'admin');
  const [grants, requests, members] = await Promise.all([
    db.studioRoleGrant.findMany({
      where: { studioId: studio.id, role: { in: ['admin', 'coach'] } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { grantedAt: 'asc' },
    }),
    db.studioTeamRequest.findMany({
      where: { studioId: studio.id },
      orderBy: { createdAt: 'desc' },
    }),
    db.studioMember.findMany({
      where: { studioId: studio.id },
      select: {
        id: true,
        name: true,
        userId: true,
        primaryCoach: { select: { coachId: true, assignedAt: true, note: true } },
      },
    }),
  ]);
  const owner = await db.user.findUniqueOrThrow({
    where: { id: studio.ownerId },
    select: { id: true, name: true, email: true },
  });
  return {
    history: await db.coachAssignmentHistory.findMany({
      where: { studioId: studio.id },
      orderBy: { endedAt: 'desc' },
    }),
    ownerId: studio.ownerId,
    grants: [
      ...(!grants.some((g) => g.userId === studio.ownerId && g.role === 'admin')
        ? [{ id: 'owner', userId: owner.id, role: 'admin', status: 'active', user: owner }]
        : []),
      ...grants,
    ],
    requests,
    members,
  };
}
export async function mutateTeam(actorId: string, command: z.infer<typeof teamCommand>) {
  const { studio } = await requireStudio(actorId, 'admin');
  await writeMetrics(
    () =>
      db.$transaction(
        async (tx) => {
          await requireStudio(actorId, 'admin', studio.id, tx);
          const c = command;
          let targetId = studio.id;
          if (c.action === 'invite') {
            const account = await tx.user.findUnique({ where: { email: c.email } });
            if (account) {
              const access = await studioAccess(account.id, undefined, tx);
              if (access && access.studio.id !== studio.id)
                throw new ApiError(409, 'This account already belongs to another studio.');
              if (access?.coach)
                throw new ApiError(409, 'This account already has coaching access.');
            }
            const request = await tx.studioTeamRequest.upsert({
              where: {
                studioId_email_role: { studioId: studio.id, email: c.email, role: 'coach' },
              },
              create: {
                studioId: studio.id,
                email: c.email,
                expiresAt: new Date(Date.now() + 7 * 86400000),
              },
              update: { status: 'pending', expiresAt: new Date(Date.now() + 7 * 86400000) },
            });
            targetId = request.id;
          } else if (c.action === 'withdraw') {
            const changed = await tx.studioTeamRequest.updateMany({
              where: { id: c.requestId, studioId: studio.id, status: 'pending' },
              data: { status: 'withdrawn' },
            });
            if (!changed.count) throw new ApiError(404, 'Pending coach request not found.');
            targetId = c.requestId;
          } else if (c.action === 'assign') {
            const member = await tx.studioMember.findFirst({
              where: { id: c.memberId, studioId: studio.id },
            });
            if (!member) throw new ApiError(404, 'Member not found.');
            if (c.coachId) {
              await requireStudio(c.coachId, 'coach', studio.id, tx);
              const current = await tx.primaryCoachAssignment.findUnique({
                where: { memberId: member.id },
              });
              if (current && current.coachId !== c.coachId)
                await tx.coachAssignmentHistory.create({
                  data: {
                    memberId: current.memberId,
                    studioId: studio.id,
                    coachId: current.coachId,
                    assignedAt: current.assignedAt,
                    note: current.note,
                  },
                });
              if (current?.coachId !== c.coachId)
                await tx.primaryCoachAssignment.upsert({
                  where: { memberId: member.id },
                  create: { memberId: member.id, coachId: c.coachId },
                  update: { coachId: c.coachId, assignedAt: new Date(), note: '' },
                });
            } else {
              const previous = await tx.primaryCoachAssignment.findUnique({
                where: { memberId: member.id },
              });
              if (previous)
                await tx.coachAssignmentHistory.create({
                  data: {
                    memberId: previous.memberId,
                    studioId: studio.id,
                    coachId: previous.coachId,
                    assignedAt: previous.assignedAt,
                    note: previous.note,
                  },
                });
              await tx.primaryCoachAssignment.deleteMany({ where: { memberId: member.id } });
            }
            targetId = member.id;
          } else {
            if (c.userId === studio.ownerId)
              throw new ApiError(
                403,
                'The founding admin is protected and cannot be suspended or revoked.',
              );
            if (c.status === 'active') {
              const currentAccess = await studioAccess(c.userId, undefined, tx);
              if (currentAccess && currentAccess.studio.id !== studio.id)
                throw new ApiError(409, 'This account now belongs to another studio.');
            }
            const changed = await tx.studioRoleGrant.updateMany({
              // The original accepted grant stays scoped even after a studio transfer.
              where: { studioId: studio.id, userId: c.userId, role: 'coach' },
              data: { status: c.status },
            });
            if (!changed.count) throw new ApiError(404, 'Coach grant not found.');
            if (c.status !== 'active') {
              const assignments = await tx.primaryCoachAssignment.findMany({
                where: { coachId: c.userId, member: { studioId: studio.id } },
              });
              for (const a of assignments)
                await tx.coachAssignmentHistory.create({
                  data: {
                    memberId: a.memberId,
                    studioId: studio.id,
                    coachId: a.coachId,
                    assignedAt: a.assignedAt,
                    note: a.note,
                  },
                });
              await tx.primaryCoachAssignment.deleteMany({
                where: { coachId: c.userId, member: { studioId: studio.id } },
              });
              await tx.classSession.updateMany({
                where: {
                  studioId: studio.id,
                  hostId: c.userId,
                  status: { in: ['scheduled', 'live'] },
                },
                data: { hostId: studio.ownerId },
              });
              await tx.studioClass.updateMany({
                where: { studioId: studio.id, hostId: c.userId, status: 'scheduled' },
                data: { hostId: studio.ownerId },
              });
              const account = await tx.user.findUniqueOrThrow({ where: { id: c.userId } });
              await tx.studioTeamRequest.updateMany({
                where: { studioId: studio.id, email: account.email, status: 'pending' },
                data: { status: 'withdrawn' },
              });
            }
            targetId = c.userId;
          }
          await tx.auditEvent.create({
            data: {
              actorId,
              action: `team.${c.action}${c.action === 'status' ? `.${c.status}` : ''}`,
              targetId,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      ),
    process.env.DATABASE_PROVIDER !== 'postgresql',
  );
  if (command.action === 'status' && command.status !== 'active')
    await revokeStaffVideo(studio.id, command.userId);
  logEvent('info', 'studio_team_operation', {
    ...requestContext.getStore(),
    action: command.action,
    studioId: studio.id,
    actorId,
  });
  if (command.action === 'invite') {
    try {
      await sendMail(
        command.email,
        `${studio.name}: coach invitation`,
        `You have been invited to coach at ${studio.name}. Sign up or sign in with this email, verify your mailbox, then accept the coach request inside the app. This request expires in 7 days.\n\n${process.env.BETTER_AUTH_URL}/app`,
      );
    } catch {
      throw new ApiError(
        502,
        'The coach request is saved, but its email could not be delivered. Use Send invitation email to retry.',
        'EMAIL_DELIVERY_FAILED',
      );
    }
  }
  return { ok: true };
}
