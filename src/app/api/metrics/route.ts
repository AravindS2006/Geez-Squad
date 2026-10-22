import { loggedRoute } from '@/lib/request-log';
import { requireParticipation } from '@/lib/member-access';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { metricSchema } from '@/lib/validation';
import { writeMetrics } from '@/lib/metrics-write';
import { metricElapsedSeconds } from '@/lib/metric-policy';
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const data = metricSchema.parse(await readJson(request));
    await writeMetrics(
      async () => {
        await db.$transaction(
          async (tx) => {
            const item = await tx.classSession.findUnique({ where: { id: data.classId } });
            const enrollment = await tx.enrollment.findUnique({
              where: { classId_userId: { classId: data.classId, userId: user.id } },
              include: { metric: true },
            });
            if (!item || !enrollment || !enrollment.consentAt)
              throw new ApiError(403, 'Join and consent to this session before sharing summaries.');
            if (
              item.status !== 'live' ||
              item.paused ||
              item.revision !== data.revision ||
              item.exercise !== data.exercise
            )
              throw new ApiError(409, 'This exercise has changed or paused.');
            await requireParticipation(item.studioId, user.id, undefined, tx);
            const previous = enrollment.metric;
            if (previous?.revision === data.revision && data.reps < previous.reps)
              throw new ApiError(409, 'Stale rep count.');
            if (previous?.revision === data.revision && data.holdSeconds < previous.holdSeconds)
              throw new ApiError(409, 'Stale hold time.');
            const delta = data.reps - (previous?.revision === data.revision ? previous.reps : 0);
            // Client estimates are untrusted: enforce a physical plausibility bound per reporting interval.
            const elapsed = metricElapsedSeconds(
              Date.now(),
              item.startedAt,
              enrollment.consentAt,
              previous?.updatedAt,
            );
            if (delta > Math.max(4, Math.ceil(elapsed * 2)))
              throw new ApiError(400, 'Rep summary changed too quickly.');
            const holdDelta =
              data.holdSeconds - (previous?.revision === data.revision ? previous.holdSeconds : 0);
            if (holdDelta > Math.max(4, Math.ceil(elapsed + 2)))
              throw new ApiError(400, 'Hold summary changed too quickly.');
            const validScore = data.confidence >= 0.65 ? data.score : null;
            const values = {
              exercise: data.exercise,
              revision: data.revision,
              reps: data.reps,
              holdSeconds: data.holdSeconds,
              score: validScore,
              confidence: data.confidence,
              phase: data.phase,
              cue: data.cue,
              quality: validScore === null ? null : (data.quality ?? null),
              rangeDegrees: data.rangeDegrees ?? null,
              repSeconds: data.repSeconds ?? null,
              trackingCoverage: data.trackingCoverage ?? null,
              rejectedReps: data.rejectedReps ?? 0,
            };
            await tx.metric.upsert({
              where: { enrollmentId: enrollment.id },
              create: { enrollmentId: enrollment.id, ...values },
              update: values,
            });
            await tx.workoutSummary.upsert({
              where: { enrollmentId: enrollment.id },
              create: {
                enrollmentId: enrollment.id,
                totalReps: delta,
                totalHoldSeconds: holdDelta,
                trackedSamples: validScore === null ? 0 : 1,
                scoreTotal: validScore ?? 0,
              },
              update: {
                totalReps: { increment: delta },
                totalHoldSeconds: { increment: holdDelta },
                trackedSamples: { increment: validScore === null ? 0 : 1 },
                scoreTotal: { increment: validScore ?? 0 },
              },
            });
          },
          { isolationLevel: 'Serializable' },
        );
      },
      Boolean(process.env.DATABASE_URL?.startsWith('file:')),
      () => rateLimit(user.id, 'metrics', 30),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/metrics', handlePOST);
