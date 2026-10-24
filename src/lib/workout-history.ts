import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { studioAccess } from './studio-access';
import { ApiError } from './security';
import { measurementData } from './measurement-contract';
import type { ExerciseId, WorkoutSetView } from './types';

export async function workoutVisibility(actorId: string): Promise<Prisma.WorkoutSetWhereInput> {
  const access = await studioAccess(actorId);
  if (!access?.coach || !access.studio) return { userId: actorId };
  const members = await db.studioMember.findMany({
    where: {
      studioId: access.studio.id,
      userId: { not: null },
      user: {
        memberships: { some: { studioId: access.studio.id } },
        NOT: {
          studioRoles: {
            some: { studioId: access.studio.id, role: 'trainee', status: { not: 'active' } },
          },
        },
      },
      ...(!access.admin ? { primaryCoach: { coachId: actorId } } : {}),
    },
    include: { primaryCoach: true },
  });
  return {
    OR: [
      { userId: actorId },
      ...members.map((m) => ({
        userId: m.userId!,
        ...(!access.admin ? { startedAt: { gte: m.primaryCoach!.assignedAt } } : {}),
        OR: [{ classId: null }, { class: { studioId: access.studio!.id } }],
      })),
    ],
  };
}
export const historyInclude = {
  user: { select: { name: true } },
  class: { select: { title: true } },
  corrections: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
} satisfies Prisma.WorkoutSetInclude;
export type HistoryRow = Prisma.WorkoutSetGetPayload<{ include: typeof historyInclude }>;
export function workoutView(row: HistoryRow): WorkoutSetView {
  const { user, class: session, measurement, corrections, ...set } = row;
  const latest = corrections[0];
  return {
    ...set,
    ...measurementData(measurement),
    exercise: set.exercise as ExerciseId,
    userName: user.name,
    classTitle: session?.title ?? null,
    startedAt: set.startedAt.toISOString(),
    endedAt: set.endedAt.toISOString(),
    correction: latest
      ? {
          reps: latest.reps,
          holdMs: latest.holdMs,
          reason: latest.reason,
          actorId: latest.actorId,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
  };
}
export function decodeHistoryCursor(raw: string | null) {
  if (!raw) return undefined;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (typeof c.id !== 'string' || c.id.length > 100 || !Number.isFinite(Date.parse(c.at)))
      throw new Error();
    return {
      OR: [{ endedAt: { lt: new Date(c.at) } }, { endedAt: new Date(c.at), id: { lt: c.id } }],
    } satisfies Prisma.WorkoutSetWhereInput;
  } catch {
    throw new ApiError(400, 'Invalid history cursor.');
  }
}
