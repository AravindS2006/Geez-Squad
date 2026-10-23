import 'server-only';
import { db } from './db';
import { ApiError } from './security';
import type { WorkspaceData, Block, ClassView, ExerciseId } from './types';
import { sessionEditVersion } from './session-management';
import { compareSessions } from './session-timing';
import { studioAccess, classPermissionView } from './studio-access';
import type { Prisma } from '@prisma/client';
export async function workspaceData(userId: string, classId?: string): Promise<WorkspaceData> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(401, 'Please sign in.');
  const access = await studioAccess(userId);
  const studio = access?.studio ?? null;
  const coach = !!access?.coach;
  const memberProfiles = studio
    ? await db.studioMember.findMany({
        where: {
          studioId: studio.id,
          userId: { not: null },
          user: {
            memberships: { some: { studioId: studio.id } },
            NOT: {
              studioRoles: {
                some: { studioId: studio.id, role: 'trainee', status: { not: 'active' } },
              },
            },
          },
          ...(!access?.admin ? { primaryCoach: { coachId: userId } } : {}),
        },
        include: { primaryCoach: true },
      })
    : [];
  const visibleIds = memberProfiles.map((m) => m.userId!);
  const setVisibility: Prisma.WorkoutSetWhereInput = {
    OR: [
      { userId },
      ...memberProfiles
        .filter((m) => coach)
        .map((m) => ({
          userId: m.userId!,
          ...(access?.admin ? {} : { startedAt: { gte: m.primaryCoach!.assignedAt } }),
          OR: [{ classId: null }, { class: { studioId: studio!.id } }],
        })),
    ],
  };
  const checkInVisibility: Prisma.CheckInWhereInput = {
    OR: [
      { userId },
      ...memberProfiles
        .filter((m) => coach)
        .map((m) => ({
          userId: m.userId!,
          ...(access?.admin ? {} : { createdAt: { gte: m.primaryCoach!.assignedAt } }),
        })),
    ],
  };
  const [members, plans, classes, billing, sets, checkIns, assignments] = await Promise.all([
    studio && coach
      ? db.membership.findMany({
          where: { studioId: studio.id, userId: { in: visibleIds } },
          include: {
            user: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [],
    studio
      ? db.workoutPlan.findMany({
          where: { studioId: studio.id, ...(coach ? {} : { assignments: { some: { userId } } }) },
          orderBy: { createdAt: 'desc' },
        })
      : [],
    Promise.all(
      (classId ? [undefined] : ['live', 'scheduled', 'completed', 'cancelled']).map((status) =>
        db.classSession.findMany({
          where: {
            ...(classId ? { id: classId } : {}),
            ...(status ? { status } : {}),
            ...(access?.admin
              ? { studioId: studio!.id }
              : {
                  OR: [
                    ...(coach ? [{ studioId: studio!.id, hostId: userId }] : []),
                    { enrollments: { some: { userId } } },
                  ],
                }),
          },
          include: {
            _count: { select: { enrollments: true } },
            studio: { include: { owner: { select: { name: true } } } },
            plan: { select: { blocks: true } },
            enrollments: {
              // Per-class filtering below prevents session-only hosts from seeing unrelated profiles.
              where: {},
              include: { user: { select: { id: true, name: true } }, metric: true, summary: true },
            },
          },
          orderBy: { startsAt: status === 'scheduled' || status === 'live' ? 'asc' : 'desc' },
          take: 100,
        }),
      ),
    ).then((groups) => groups.flat()),
    db.billingSubscription.findUnique({ where: { userId } }),
    db.workoutSet.findMany({
      where: setVisibility,
      include: { user: { select: { name: true } }, class: { select: { title: true } } },
      orderBy: { endedAt: 'desc' },
      take: 500,
    }),
    db.checkIn.findMany({
      where: checkInVisibility,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    studio
      ? db.planAssignment.findMany({
          where: { studioId: studio.id, ...(coach ? { userId: { in: visibleIds } } : { userId }) },
        })
      : [],
  ]);
  const hosts = await db.user.findMany({
    where: { id: { in: [...new Set(classes.map((c) => c.hostId ?? c.studio.ownerId))] } },
    select: { id: true, name: true },
  });
  const classAdmins = await db.studioRoleGrant.findMany({
    where: {
      studioId: { in: [...new Set(classes.map((c) => c.studioId))] },
      role: 'admin',
      status: 'active',
    },
    select: { studioId: true, userId: true },
  });
  const classViews: ClassView[] = classes.map((c) => {
    const permissions = classPermissionView(
      c,
      userId,
      access,
      classAdmins.filter((a) => a.studioId === c.studioId).map((a) => a.userId),
    );
    return {
      id: c.id,
      ...(permissions.canManage ? { editVersion: sessionEditVersion(c) } : {}),
      permissions,
      title: c.title,
      startsAt: c.startsAt.toISOString(),
      duration: c.duration,
      capacity: c.capacity,
      participantCount: c._count.enrollments,
      status: c.status,
      exercise: c.exercise as ExerciseId,
      revision: c.revision,
      paused: c.paused,
      startedAt: c.startedAt?.toISOString() ?? null,
      endedAt: c.endedAt?.toISOString() ?? null,
      coachId: permissions.hostId,
      coachName:
        hosts.find((h) => h.id === permissions.hostId)?.name ??
        (permissions.hostId === c.studio.ownerId ? c.studio.owner.name : 'Former coach'),
      planId: c.planId,
      workout: (c.plan?.blocks ?? []) as unknown as Block[],
      participants: c.enrollments
        .filter((e) => permissions.canManage || e.userId === userId)
        .map((e) => ({
          id: e.userId,
          name: e.user.name,
          helpRequested: e.helpRequested,
          metric: e.metric
            ? {
                exercise: e.metric.exercise,
                revision: e.metric.revision,
                reps: e.metric.reps,
                holdSeconds: e.metric.holdSeconds,
                score: e.metric.score,
                confidence: e.metric.confidence,
                phase: e.metric.phase,
                cue: e.metric.cue,
                quality: e.metric.quality,
                rangeDegrees: e.metric.rangeDegrees,
                repSeconds: e.metric.repSeconds,
                trackingCoverage: e.metric.trackingCoverage,
                rejectedReps: e.metric.rejectedReps,
                updatedAt: e.metric.updatedAt.toISOString(),
              }
            : null,
          summary: e.summary
            ? {
                totalReps: e.summary.totalReps,
                totalHoldSeconds: e.summary.totalHoldSeconds,
                trackedSamples: e.summary.trackedSamples,
                scoreTotal: e.summary.scoreTotal,
              }
            : null,
        })),
    };
  });
  return {
    coaches:
      studio && coach
        ? await db.user.findMany({
            where: {
              OR: [
                { id: studio.ownerId },
                {
                  studioRoles: {
                    some: {
                      studioId: studio.id,
                      status: 'active',
                      role: { in: ['admin', 'coach'] },
                    },
                  },
                },
              ],
            },
            select: { id: true, name: true },
          })
        : [],
    demo: false,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role === 'unset' ? 'unset' : coach ? 'coach' : 'trainee',
      goal: user.goal,
    },
    permissions: {
      admin: !!access?.admin,
      coach,
      trainee: !!access?.trainee,
      role: access?.role ?? 'trainee',
    },
    studio: studio ? { id: studio.id, name: studio.name } : null,
    clients: members.map((m) => ({
      id: m.userId,
      name: memberProfiles.find((p) => p.userId === m.userId)?.name ?? m.user.name,
      email: m.user.email,
      role: m.user.role,
      goal: memberProfiles.find((p) => p.userId === m.userId)?.goal ?? m.user.goal,
      joinedAt: m.createdAt.toISOString(),
      coachNote: access?.admin
        ? m.coachNote
        : (memberProfiles.find((p) => p.userId === m.userId)?.primaryCoach?.note ?? ''),
      assignedAt:
        memberProfiles.find((p) => p.userId === m.userId)?.primaryCoach?.assignedAt.toISOString() ??
        null,
      latestCheckIn: checkIns.find((e) => e.userId === m.userId)
        ? {
            ...checkIns.find((e) => e.userId === m.userId)!,
            userName: m.user.name,
            createdAt: checkIns.find((e) => e.userId === m.userId)!.createdAt.toISOString(),
          }
        : null,
      lastTrainingAt:
        sets
          .find((e) => e.userId === m.userId && (e.reps > 0 || e.holdMs > 0))
          ?.endedAt.toISOString() ?? null,
      completedSetsThisWeek: sets.filter(
        (e) =>
          e.userId === m.userId && e.completed && e.endedAt.getTime() >= Date.now() - 7 * 86400000,
      ).length,
    })),
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      blocks: p.blocks as unknown as Block[],
      canEdit: !!access?.admin || p.createdById === userId,
    })),
    classes: classViews.sort(compareSessions),
    workoutSets: sets.map(({ user: person, class: session, ...set }) => ({
      ...set,
      exercise: set.exercise as ExerciseId,
      userName: person.name,
      classTitle: session?.title ?? null,
      startedAt: set.startedAt.toISOString(),
      endedAt: set.endedAt.toISOString(),
      createdAt: set.createdAt.toISOString(),
    })),
    checkIns: checkIns.map(({ user: person, ...entry }) => ({
      ...entry,
      userName: person.name,
      createdAt: entry.createdAt.toISOString(),
    })),
    assignments: assignments.map((entry) => ({
      userId: entry.userId,
      planId: entry.planId,
      assignedAt: entry.assignedAt.toISOString(),
    })),
    billing: billing?.status ?? 'inactive',
    services: {
      video: !!(
        process.env.LIVEKIT_URL &&
        process.env.LIVEKIT_API_KEY &&
        process.env.LIVEKIT_API_SECRET
      ),
      billing: !!(
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_PRICE_ID &&
        process.env.STRIPE_WEBHOOK_SECRET
      ),
      email: ['smtp', 'resend'].includes(process.env.EMAIL_DELIVERY || ''),
    },
  };
}
