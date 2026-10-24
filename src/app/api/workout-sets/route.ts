import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  ApiError,
  requireUser,
  requireClass,
  readJson,
  rateLimit,
  safeError,
} from '@/lib/security';
import { workoutSetSchema } from '@/lib/validation';
import { isHoldExercise } from '@/lib/exercise-profiles';
import { requireParticipation } from '@/lib/member-access';
import { requireExercise } from '@/lib/exercise-access';
import { studioAccess } from '@/lib/studio-access';
import { splitMeasurement } from '@/lib/measurement-contract';
import type { Prisma } from '@prisma/client';

async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const { ownerId, ...data } = workoutSetSchema.parse(await readJson(request));
    if (ownerId && ownerId !== user.id)
      throw new ApiError(403, 'This workout belongs to a different signed-in account.');
    await rateLimit(user.id, 'workout-sets', 30);
    const existing = await db.workoutSet.findUnique({
      where: { userId_clientId: { userId: user.id, clientId: data.clientId } },
    });
    if (existing) return NextResponse.json({ id: existing.id, saved: true });
    if (
      Date.parse(data.endedAt) > Date.now() + 30000 ||
      Date.parse(data.startedAt) < Date.now() - 30 * 86400000
    )
      throw new ApiError(400, 'Save a workout within 30 days of training.');
    const access = await studioAccess(user.id);
    const definition = await requireExercise(data.exercise, access?.studio?.id);
    const hold = definition.targetUnit === 'seconds';
    const source =
      data.measurementSource ?? (definition.profileId ? 'automatic' : hold ? 'timer' : 'manual');
    if (source === 'timer' && !hold) throw new ApiError(400, 'Use repetitions for this exercise.');
    if (
      source !== 'automatic' &&
      (data.formScore !== null ||
        data.qualityScore !== null ||
        data.rangeDegrees !== null ||
        data.repSeconds !== null ||
        data.confidence !== null ||
        data.trackedMs !== 0 ||
        data.arms)
    )
      throw new ApiError(400, 'Manual results cannot contain inferred measurements.');
    if (data.schemaVersion === 2 && data.armMode && !data.arms && source === 'automatic')
      throw new ApiError(400, 'Arm measurements are required for this workout mode.');
    if (data.targetUnit && data.targetUnit !== definition.targetUnit)
      throw new ApiError(400, 'Exercise target unit changed.');
    const progress = hold ? data.holdMs / 1000 : data.reps;
    if (data.completed !== progress >= data.target)
      throw new ApiError(400, 'The completed target does not match the recorded set.');
    if ((!hold && data.holdMs !== 0) || (hold && data.reps !== 0))
      throw new ApiError(400, 'Use repetitions or hold time for the selected exercise.');
    if (data.classId) {
      const item = await requireClass(data.classId, user.id);
      const enrollment = item.enrollments.find((entry) => entry.userId === user.id);
      if (!enrollment?.consentAt || !['live', 'completed'].includes(item.status))
        throw new ApiError(403, 'Join and consent to this class before saving shared sets.');
      if (item.status === 'live') await requireParticipation(item.studioId, user.id);
      if (
        !item.startedAt ||
        data.revision > item.revision ||
        Date.parse(data.startedAt) < item.startedAt.getTime() - 1000 ||
        (item.endedAt && Date.parse(data.endedAt) > item.endedAt.getTime() + 5000)
      )
        throw new ApiError(409, 'This set is outside the recorded class.');
    }
    const { data: values, measurement } = splitMeasurement(data);
    measurement.exerciseLabel = definition.name;
    measurement.targetUnit = definition.targetUnit;
    measurement.measurementSource =
      data.measurementSource ?? (definition.profileId ? 'automatic' : hold ? 'timer' : 'manual');
    const saved = await db.workoutSet.upsert({
      where: { userId_clientId: { userId: user.id, clientId: data.clientId } },
      create: {
        ...(values as Omit<typeof data, keyof import('@/lib/measurement-contract').Measurement>),
        measurement: measurement as Prisma.InputJsonValue,
        userId: user.id,
        startedAt: new Date(data.startedAt),
        endedAt: new Date(data.endedAt),
      },
      update: {},
    });
    return NextResponse.json({ id: saved.id, saved: true });
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/workout-sets', handlePOST);
