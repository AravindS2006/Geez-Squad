import { z } from 'zod';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workoutVisibility } from '@/lib/workout-history';
import { requireUser, readJson, safeError, rateLimit, ApiError } from '@/lib/security';
import { measurementData } from '@/lib/measurement-contract';
import { usesHoldTime } from '@/lib/exercise-library';
import { loggedRoute } from '@/lib/request-log';
const schema = z
  .object({
    clientId: z.uuid(),
    setId: z.string().min(1).max(100),
    reps: z.number().int().min(0).max(500),
    holdMs: z.number().int().min(0).max(7200000),
    reason: z.string().trim().min(5).max(400),
  })
  .strict();
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const data = schema.parse(await readJson(request));
    await rateLimit(user.id, 'workout-corrections', 20);
    const set = await db.workoutSet.findFirst({
      where: { AND: [{ id: data.setId }, await workoutVisibility(user.id)] },
    });
    if (!set) throw new ApiError(404, 'This workout is not available.');
    const metadata = measurementData(set.measurement);
    const hold = metadata.targetUnit === 'seconds' || usesHoldTime(set.exercise);
    if ((hold && data.reps !== 0) || (!hold && data.holdMs !== 0) || data.holdMs > set.activeMs)
      throw new ApiError(400, 'Use the exercise target unit and observed activity duration.');
    const existing = await db.workoutCorrection.findUnique({ where: { id: data.clientId } });
    if (existing && (existing.setId !== set.id || existing.actorId !== user.id))
      throw new ApiError(409, 'Correction identity already used.');
    const correction =
      existing ??
      (await db.$transaction(async (tx) => {
        const row = await tx.workoutCorrection.create({
          data: {
            id: data.clientId,
            setId: set.id,
            actorId: user.id,
            reps: data.reps,
            holdMs: data.holdMs,
            reason: data.reason,
          },
        });
        await tx.auditEvent.create({
          data: { actorId: user.id, action: 'workout.corrected', targetId: set.id },
        });
        return row;
      }));
    return NextResponse.json({ correction });
  } catch (error) {
    return safeError(error);
  }
}
export const POST = loggedRoute('/api/workout-sets/corrections', handlePOST);
