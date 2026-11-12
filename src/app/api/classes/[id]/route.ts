import { classPermissions } from '@/lib/studio-access';
import { loggedRoute } from '@/lib/request-log';
import { participation, reconcileClassParticipants } from '@/lib/member-access';
import { NextResponse, after } from 'next/server';
import { recordClassPresence } from '@/lib/class-completion';
import { db } from '@/lib/db';
import { ApiError, requireUser, safeError } from '@/lib/security';
import { measurementData } from '@/lib/measurement-contract';
import { planBlocks } from '@/lib/workout-run';
import type { Block } from '@/lib/types';
import { LEGACY_AUTOMATIC_IDS } from '@/lib/exercise-profiles';
async function handleGET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const item = await db.classSession.findUnique({
      where: { id },
      include: {
        studio: { select: { id: true, ownerId: true } },
        plan: { select: { blocks: true } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!item) throw new ApiError(404, 'This session is not available.');
    const permissions = await classPermissions(item, user.id);
    const coach = permissions.canManage;
    // Lifecycle bookkeeping after the response: throttled coach presence, or
    // completion of a class its coach abandoned (src/lib/class-completion.ts).
    after(() => recordClassPresence(item, coach));
    // Every participant polls this route every few seconds. These reads are
    // independent, so they run concurrently instead of as sequential round trips.
    // Authorization still completes (above) before any of them is returned.
    const [host, enrollments, messages] = await Promise.all([
      db.user.findUnique({ where: { id: permissions.hostId }, select: { name: true } }),
      // Trainees only query their own enrollment; class size does not multiply
      // the private metrics fetched for every trainee's three-second poll.
      db.enrollment.findMany({
        where: { classId: id, ...(coach ? {} : { userId: user.id }) },
        include: { user: { select: { id: true, name: true } }, metric: true, summary: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.message.findMany({
        where: {
          classId: id,
          OR: [{ recipientId: null }, { recipientId: user.id }, { senderId: user.id }],
        },
        include: { sender: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
    ]);
    if (!coach && !enrollments.length) throw new ApiError(404, 'This session is not available.');
    const blocks = planBlocks({
      id: item.planId ?? item.id,
      blocks: (item.workoutSnapshot ?? item.plan?.blocks ?? []) as unknown as Block[],
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
    const [eligibility] = await Promise.all([
      coach || ['completed', 'cancelled'].includes(item.status)
        ? { allowed: true, reason: '' }
        : participation(item.studio.id, user.id),
      item.status === 'live'
        ? reconcileClassParticipants(id, item.studio.id, coach ? undefined : user.id)
        : null,
    ]);
    return NextResponse.json(
      {
        participationAllowed: eligibility.allowed,
        participationReason: eligibility.reason,
        permissions,
        coachId: permissions.hostId,
        coachName: host?.name ?? 'Studio coach',
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
          name: e.user.name,
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
          senderName: m.sender.name,
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
