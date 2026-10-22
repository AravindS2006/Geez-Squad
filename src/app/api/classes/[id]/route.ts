import { loggedRoute } from '@/lib/request-log';
import { participation, revokeIneligibleParticipants } from '@/lib/member-access';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, requireUser, safeError } from '@/lib/security';
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
    const coach = item.studio.ownerId === user.id;
    // Trainees only query their own enrollment; class size does not multiply
    // the private metrics fetched for every trainee's three-second poll.
    const enrollments = await db.enrollment.findMany({
      where: { classId: id, ...(coach ? {} : { userId: user.id }) },
      include: { user: { select: { id: true, name: true } }, metric: true, summary: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!coach && !enrollments.length) throw new ApiError(404, 'This session is not available.');
    const eligibility =
      coach || ['completed', 'cancelled'].includes(item.status)
        ? { allowed: true, reason: '' }
        : await participation(item.studio.id, user.id);
    if (item.status === 'live')
      await revokeIneligibleParticipants(item.studio.id, coach ? undefined : user.id);
    const messages = await db.message.findMany({
      where: {
        classId: id,
        OR: [{ recipientId: null }, { recipientId: user.id }, { senderId: user.id }],
      },
      include: { sender: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
    return NextResponse.json(
      {
        participationAllowed: eligibility.allowed,
        participationReason: eligibility.reason,
        title: item.title,
        startsAt: item.startsAt,
        duration: item.duration,
        capacity: item.capacity,
        planId: item.planId,
        workout: item.plan?.blocks ?? [],
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
          metric: e.metric,
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
