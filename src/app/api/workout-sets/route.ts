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
    const progress = isHoldExercise(data.exercise) ? data.holdMs / 1000 : data.reps;
    if (data.completed !== progress >= data.target)
      throw new ApiError(400, 'The completed target does not match the recorded set.');
    if (
      (!isHoldExercise(data.exercise) && data.holdMs !== 0) ||
      (isHoldExercise(data.exercise) && data.reps !== 0)
    )
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
    const saved = await db.workoutSet.upsert({
      where: { userId_clientId: { userId: user.id, clientId: data.clientId } },
      create: {
        ...data,
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
