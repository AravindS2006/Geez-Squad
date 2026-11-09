import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { studioAccess } from './studio-access';
import { ApiError } from './security';
import { measurementData } from './measurement-contract';
import { historyAccumulator } from './history-totals';
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
/** Insight totals cover at most one year; longer ranges remain available as paged records. */
export const HISTORY_TOTALS_MAX_DAYS = 365;
/** Hard ceiling so one request cannot scan an unbounded studio history. */
export const HISTORY_TOTALS_MAX_ROWS = 20000;
const TOTALS_BATCH = 1000;
const totalsInclude = {
  corrections: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
} satisfies Prisma.WorkoutSetInclude;
type TotalsRow = Prisma.WorkoutSetGetPayload<{ include: typeof totalsInclude }>;
/**
 * Effective totals depend on the latest correction, measurement JSON (load basis,
 * arm counts, target unit) and the viewer's calendar day, so they are derived from
 * rows rather than SQL sums. Rows are loaded without names/class titles, in bounded
 * batches, inside a capped date window and row ceiling.
 */
export async function historyTotals(
  where: Prisma.WorkoutSetWhereInput,
  timeZone: string,
  options: { days: number; maxRows?: number; now?: number },
) {
  const windowDays = Math.min(options.days, HISTORY_TOTALS_MAX_DAYS);
  const maxRows = options.maxRows ?? HISTORY_TOTALS_MAX_ROWS;
  const since = new Date((options.now ?? Date.now()) - windowDays * 86400000);
  const scoped: Prisma.WorkoutSetWhereInput = { AND: [where, { endedAt: { gte: since } }] };
  const accumulator = historyAccumulator(timeZone);
  const users = new Map<string, ReturnType<typeof historyAccumulator>>();
  const groups = new Map<
    string,
    {
      exercise: string;
      name: string;
      version: string;
      accumulator: ReturnType<typeof historyAccumulator>;
      recentQuality: number[];
    }
  >();
  let scanned = 0,
    truncated = false,
    scanCursor: Prisma.WorkoutSetWhereInput = {};
  for (;;) {
    const take = Math.min(TOTALS_BATCH, maxRows - scanned);
    const batch: TotalsRow[] = await db.workoutSet.findMany({
      where: { AND: [scoped, scanCursor] },
      include: totalsInclude,
      orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const rows = batch.slice(0, take),
      more = batch.length > take;
    scanned += rows.length;
    for (const row of rows) {
      const view = workoutView({ ...row, user: { name: '' }, class: null });
      accumulator.add(view);
      if (!users.has(view.userId)) users.set(view.userId, historyAccumulator(timeZone));
      users.get(view.userId)!.add(view);
      const key = `${view.exercise}:${view.ruleVersion}`;
      if (!groups.has(key))
        groups.set(key, {
          exercise: view.exercise,
          name: view.exerciseLabel ?? view.exercise,
          version: view.ruleVersion,
          accumulator: historyAccumulator(timeZone),
          recentQuality: [],
        });
      const group = groups.get(key)!;
      group.accumulator.add(view);
      if (group.recentQuality.length < 5 && view.qualityScore !== null)
        group.recentQuality.push(Math.round(view.qualityScore));
    }
    if (!more) break;
    if (scanned >= maxRows) {
      truncated = true;
      break;
    }
    const tail = rows.at(-1)!;
    scanCursor = {
      OR: [{ endedAt: { lt: tail.endedAt } }, { endedAt: tail.endedAt, id: { lt: tail.id } }],
    };
  }
  return {
    totals: accumulator.result(),
    byUser: Object.fromEntries([...users].map(([id, item]) => [id, item.result()])),
    breakdown: [...groups.values()].map(({ accumulator, recentQuality, ...group }) => ({
      ...group,
      summary: accumulator.result(),
      recentQuality: recentQuality.reverse(),
    })),
    totalsWindowDays: windowDays,
    totalsTruncated: truncated,
  };
}
