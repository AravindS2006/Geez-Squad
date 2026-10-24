import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireUser, safeError, rateLimit, ApiError } from '@/lib/security';
import {
  workoutVisibility,
  historyInclude,
  workoutView,
  decodeHistoryCursor,
} from '@/lib/workout-history';
import { historyAccumulator } from '@/lib/history-totals';
import { exerciseSchema } from '@/lib/validation';
import { loggedRoute } from '@/lib/request-log';
async function handleGET(request: Request) {
  try {
    const user = await requireUser();
    await rateLimit(user.id, 'workout-history', 30);
    const q = new URL(request.url).searchParams;
    const days = Number(q.get('days') ?? 30),
      limit = Number(q.get('limit') ?? 50);
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 36500 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApiError(400, 'Invalid history range.');
    const source = q.get('source') ?? 'all';
    if (!['all', 'live', 'practice'].includes(source))
      throw new ApiError(400, 'Invalid workout source.');
    const target = q.get('userId');
    if (target && target.length > 100) throw new ApiError(400, 'Invalid trainee.');
    try {
      new Intl.DateTimeFormat('en', { timeZone: q.get('timeZone') ?? 'UTC' });
    } catch {
      throw new ApiError(400, 'Invalid time zone.');
    }
    const cohort = q.get('cohort') === 'true';
    const exercise = q.get('exercise');
    const where: Prisma.WorkoutSetWhereInput = {
      AND: [
        await workoutVisibility(user.id),
        { endedAt: { gte: new Date(Date.now() - days * 86400000) } },
        ...(target
          ? [{ userId: target }]
          : cohort
            ? [{ userId: { not: user.id } }]
            : [{ userId: user.id }]),
        ...(exercise && exercise !== 'all' ? [{ exercise: exerciseSchema.parse(exercise) }] : []),
        ...(source === 'all' ? [] : [{ classId: source === 'practice' ? null : { not: null } }]),
      ],
    };
    const orderBy = [
      { endedAt: 'desc' },
      { id: 'desc' },
    ] satisfies Prisma.WorkoutSetOrderByWithRelationInput[];
    const rows = await db.workoutSet.findMany({
      where: { AND: [where, decodeHistoryCursor(q.get('cursor')) ?? {}] },
      include: historyInclude,
      orderBy,
      take: limit + 1,
    });
    const page = rows.slice(0, limit),
      last = page.at(-1);
    let totals;
    let byUser, breakdown;
    if (q.get('cursor') === null) {
      let scanCursor: Prisma.WorkoutSetWhereInput = {};
      const accumulator = historyAccumulator(q.get('timeZone') ?? 'UTC');
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
      for (;;) {
        const batch = await db.workoutSet.findMany({
          where: { AND: [where, scanCursor] },
          include: historyInclude,
          orderBy,
          take: 500,
        });
        batch.forEach((r) => {
          const view = workoutView(r);
          accumulator.add(view);
          if (!users.has(view.userId))
            users.set(view.userId, historyAccumulator(q.get('timeZone') ?? 'UTC'));
          users.get(view.userId)!.add(view);
          const key = `${view.exercise}:${view.ruleVersion}`;
          if (!groups.has(key))
            groups.set(key, {
              exercise: view.exercise,
              name: view.exerciseLabel ?? view.exercise,
              version: view.ruleVersion,
              accumulator: historyAccumulator(q.get('timeZone') ?? 'UTC'),
              recentQuality: [],
            });
          const group = groups.get(key)!;
          group.accumulator.add(view);
          if (group.recentQuality.length < 5 && view.qualityScore !== null)
            group.recentQuality.push(Math.round(view.qualityScore));
        });
        if (batch.length < 500) break;
        const tail = batch.at(-1)!;
        scanCursor = {
          OR: [{ endedAt: { lt: tail.endedAt } }, { endedAt: tail.endedAt, id: { lt: tail.id } }],
        };
      }
      totals = accumulator.result();
      byUser = Object.fromEntries(
        [...users].map(([id, accumulator]) => [id, accumulator.result()]),
      );
      breakdown = [...groups.values()].map(({ accumulator, recentQuality, ...group }) => ({
        ...group,
        summary: accumulator.result(),
        recentQuality: recentQuality.reverse(),
      }));
    }
    return NextResponse.json(
      {
        records: page.map(workoutView),
        totals,
        byUser,
        breakdown,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify({ id: last.id, at: last.endedAt.toISOString() })).toString(
                'base64url',
              )
            : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
}
export const GET = loggedRoute('/api/workout-history', handleGET);
