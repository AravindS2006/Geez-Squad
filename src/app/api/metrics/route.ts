import { loggedRoute } from '@/lib/request-log';
import { requireParticipation } from '@/lib/member-access';
import { NextResponse, after } from 'next/server';
import { db, isSqliteDatabase } from '@/lib/db';
import {
  ApiError,
  requireUser,
  readJson,
  localRateLimit,
  rateLimit,
  safeError,
} from '@/lib/security';
import { latestUserMetricAt, metricNeedsSharedLimit } from '@/lib/rate-window';
import { metricSchema } from '@/lib/validation';
import { writeMetrics } from '@/lib/metrics-write';
import { metricElapsedSeconds } from '@/lib/metric-policy';
import { splitMeasurement } from '@/lib/measurement-contract';
import { requireExercise } from '@/lib/exercise-access';
import type { Prisma } from '@prisma/client';
import { planBlocks } from '@/lib/workout-run';
import type { Block } from '@/lib/types';
import { classManagerIds } from '@/lib/studio-access';
import { notifyMeeting } from '@/lib/meeting-events';
import { logEvent } from '@/lib/logger';
async function handlePOST(request: Request) {
  try {
    // Heartbeat cadence: accept the session cookie cache (see requireUser).
    const user = await requireUser({ freshSession: false });
    const data = metricSchema.parse(await readJson(request));
    const stored = await writeMetrics(
      () =>
        db.$transaction(
          async (tx) => {
            const item = await tx.classSession.findUnique({
              where: { id: data.classId },
              include: { studio: { select: { ownerId: true, status: true } } },
            });
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
            const definition = await requireExercise(data.exercise, item.studioId);
            const source =
              data.measurementSource ??
              (definition.profileId
                ? 'automatic'
                : definition.targetUnit === 'seconds'
                  ? 'timer'
                  : 'manual');
            if (
              source !== 'automatic' &&
              (data.score !== null ||
                data.confidence !== 0 ||
                data.quality != null ||
                data.rangeDegrees != null ||
                data.repSeconds != null ||
                data.arms)
            )
              throw new ApiError(400, 'Manual summaries cannot contain inferred measurements.');
            if (item.activeBlockId && item.workoutSnapshot) {
              const block = planBlocks({
                id: item.planId ?? item.id,
                blocks: item.workoutSnapshot as unknown as Block[],
              }).find((b) => b.id === item.activeBlockId);
              if (block?.armMode && data.armMode !== block.armMode)
                throw new ApiError(
                  409,
                  'Use the coach-assigned workout mode or reload this page.',
                  'CLIENT_UPDATE_REQUIRED',
                );
            }
            if (data.blockId && data.blockId !== item.activeBlockId)
              throw new ApiError(409, 'The current workout block changed.');
            if (data.targetUnit && data.targetUnit !== definition.targetUnit)
              throw new ApiError(400, 'Use the exercise target unit.');
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
              measurement: {
                ...splitMeasurement(data).measurement,
                measurementSource: source,
                targetUnit: definition.targetUnit,
              } as Prisma.InputJsonValue,
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
            // Steady-cadence heartbeats write no RateLimit row; summaries faster than that
            // across all of this user's classes are charged to the shared per-user limit
            // (in this transaction, so a rolled-back summary is not counted twice on retry;
            // under Serializable, two concurrent "steady" summaries conflict and retry).
            if (metricNeedsSharedLimit(await latestUserMetricAt(tx, user.id), Date.now()))
              await rateLimit(user.id, 'metrics', 30, tx);
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
            return item;
          },
          { isolationLevel: 'Serializable' },
        ),
      isSqliteDatabase(),
      // Per-instance first filter with no write; the shared limit is applied in the
      // transaction to summaries faster than the steady cadence.
      async () => localRateLimit(user.id, 'metrics', 30),
    );
    // After commit only: nudge the class managers to refetch the authorized snapshot now
    // instead of on their next poll. The packet carries no metrics (see notifyMeeting).
    after(async () => {
      try {
        // Exactly the users who pass the GET snapshot's canManage check, never the sender.
        const grants = await db.studioRoleGrant.findMany({
          where: { studioId: stored.studioId, status: 'active', role: { in: ['admin', 'coach'] } },
          select: { userId: true, role: true, status: true },
        });
        const recipients = classManagerIds(stored, grants).filter((id) => id !== user.id);
        if (recipients.length) await notifyMeeting(stored, recipients);
      } catch {
        logEvent('warn', 'meeting_notification_delayed', {
          targetId: stored.id,
          provider: 'livekit',
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/metrics', handlePOST);
