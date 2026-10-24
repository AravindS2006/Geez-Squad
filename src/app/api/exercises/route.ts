import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser, readJson, safeError, rateLimit, ApiError } from '@/lib/security';
import { requireStudio, studioAccess } from '@/lib/studio-access';
import { customDefinition } from '@/lib/exercise-access';
import { coachingFeatures } from '@/lib/coaching-features';
import { loggedRoute } from '@/lib/request-log';
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: z.string().trim().min(2).max(80),
      equipment: z.string().trim().max(120),
      instructions: z.string().trim().min(10).max(2000),
      targetUnit: z.enum(['reps', 'seconds']),
    })
    .strict(),
  z
    .object({
      action: z.literal('rollout'),
      measurement: z.boolean(),
      library: z.boolean(),
      meeting: z.boolean(),
    })
    .strict(),
]);
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const data = schema.parse(await readJson(request));
    await rateLimit(user.id, 'exercises', 20);
    const access = await studioAccess(user.id);
    if (!access?.studio) throw new ApiError(403, 'Join a studio first.');
    await requireStudio(user.id, data.action === 'rollout' ? 'admin' : 'coach', access.studio.id);
    if (data.action === 'rollout') {
      const { action: _action, ...flags } = data;
      await db.studio.update({
        where: { id: access.studio.id },
        data: { coachingFeatures: flags },
      });
      await db.auditEvent.create({
        data: { actorId: user.id, action: 'coaching.rollout', targetId: access.studio.id },
      });
      return NextResponse.json({ features: coachingFeatures(flags) });
    }
    if ((await db.customExercise.count({ where: { studioId: access.studio.id } })) >= 200)
      throw new ApiError(400, 'This studio has reached 200 custom exercises.');
    const exercise = await db.customExercise.create({
      data: {
        id: `custom:${crypto.randomUUID()}`,
        studioId: access.studio.id,
        createdById: user.id,
        name: data.name,
        equipment: data.equipment,
        instructions: data.instructions,
        targetUnit: data.targetUnit,
      },
    });
    return NextResponse.json({ exercise: customDefinition(exercise) }, { status: 201 });
  } catch (error) {
    return safeError(error);
  }
}
export const POST = loggedRoute('/api/exercises', handlePOST);
