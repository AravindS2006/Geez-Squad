import { classAccessGrants, classPermissionsFromGrants } from '@/lib/studio-access';
import { loggedRoute } from '@/lib/request-log';
import { participation, reconcileClassParticipants } from '@/lib/member-access';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, requireSessionUser, safeError } from '@/lib/security';
import { measurementData } from '@/lib/measurement-contract';
import { planBlocks } from '@/lib/workout-run';
import type { Block } from '@/lib/types';
import { LEGACY_AUTOMATIC_IDS } from '@/lib/exercise-profiles';
/**
 * Every participant polls this route every few seconds, so it is kept to a fixed,
 * small number of reads (see tests/class-poll-queries.test.ts). Identity may come from
 * the session cookie cache; every permission below is read from the database on every
 * poll.
 */
async function handleGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const item = await db.classSession.findUnique({
      where: { id },
      include: {
        studio: { select: { id: true, ownerId: true } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!item) throw new ApiError(404, 'This session is not available.');
    // The actor's own grants (staff and trainee) and the studio's admins, in one read.
    const grants = await classAccessGrants(item.studioId, user.id);
    const permissions = classPermissionsFromGrants(item, user.id, grants);
    const coach = permissions.canManage;
    const ended = ['completed', 'cancelled'].includes(item.status);
    // Independent reads run concurrently. Nothing is returned before the enrollment
    // check below, which keeps non-participants at 404.
    const [enrollments, messages, eligibility, planned] = await Promise.all([
      // Trainees only query their own enrollment; class size does not multiply
      // the private metrics fetched for every trainee's three-second poll.
      db.enrollment.findMany({
        where: { classId: id, ...(coach ? {} : { userId: user.id }) },
        include: { metric: true, summary: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.message.findMany({
        where: {
          classId: id,
          OR: [{ recipientId: null }, { recipientId: user.id }, { senderId: user.id }],
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
      coach || ended
        ? { allowed: true, reason: '' }
        : participation(
            item.studioId,
            user.id,
            undefined,
            undefined,
            grants.find((g) => g.userId === user.id && g.role === 'trainee') ?? null,
          ),
      // Sessions started from a plan carry a snapshot; only older ones read the plan.
      item.workoutSnapshot == null && item.planId
        ? db.workoutPlan.findUnique({ where: { id: item.planId }, select: { blocks: true } })
        : null,
    ]);
    if (!coach && !enrollments.length) throw new ApiError(404, 'This session is not available.');
    // Host, participant and sender names in one read.
    const people = await db.user.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              permissions.hostId,
              ...enrollments.map((e) => e.userId),
              ...messages.map((m) => m.senderId),
            ]),
          ],
        },
      },
      select: { id: true, name: true },
    });
    const nameOf = (userId: string) => people.find((p) => p.id === userId)?.name;
    const blocks = planBlocks({
      id: item.planId ?? item.id,
      blocks: (item.workoutSnapshot ?? planned?.blocks ?? []) as unknown as Block[],
    });
    const activeBlock = blocks.find((b) => b.id === item.activeBlockId);
    if (
      _request.headers.get('X-Coaching-Client') !== '2' &&
      (!LEGACY_AUTOMATIC_IDS.includes(item.exercise) || activeBlock?.armMode)
    )
      throw new ApiError(
        409,
        'Reload this page to use the current workout player.',
        'CLIENT_UPDATE_REQUIRED',
      );
    // LiveKit cleanup for revoked participants runs after the response is sent; HTTP
    // access above has already been decided from the database.
    if (item.status === 'live') {
      const studioId = item.studioId;
      const onlyUserId = coach ? undefined : user.id;
      after(() => reconcileClassParticipants(id, studioId, onlyUserId));
    }
    return NextResponse.json(
      {
        participationAllowed: eligibility.allowed,
        participationReason: eligibility.reason,
        permissions,
        coachId: permissions.hostId,
        coachName: nameOf(permissions.hostId) ?? 'Studio coach',
        title: item.title,
        startsAt: item.startsAt,
        duration: item.duration,
        capacity: item.capacity,
        planId: item.planId,
        workout: blocks,
        activeBlockId: item.activeBlockId,
        controlSequence: item.controlSequence,
        participantCount: item._count.enrollments,
        status: item.status,
        exercise: item.exercise,
        revision: item.revision,
        paused: item.paused,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        participants: enrollments.map((e) => ({
          id: e.userId,
          name: nameOf(e.userId) ?? '',
          helpRequested: e.helpRequested,
          metric: e.metric
            ? { ...e.metric, ...measurementData(e.metric.measurement), measurement: undefined }
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
        messages: messages.reverse().map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderName: nameOf(m.senderId) ?? '',
          recipientId: m.recipientId,
          text: m.text,
          kind: m.kind,
          createdAt: m.createdAt,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/classes/[id]', handleGET);
