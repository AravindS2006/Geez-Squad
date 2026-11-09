import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireUser, safeError, rateLimit, ApiError } from '@/lib/security';
import {
  workoutVisibility,
  historyInclude,
  workoutView,
  decodeHistoryCursor,
  historyTotals,
} from '@/lib/workout-history';
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
    // Totals are only computed for the first page and cover at most 365 days.
    const summary =
      q.get('cursor') === null
        ? await historyTotals(where, q.get('timeZone') ?? 'UTC', { days })
        : undefined;
    return NextResponse.json(
      {
        records: page.map(workoutView),
        totals: summary?.totals,
        byUser: summary?.byUser,
        breakdown: summary?.breakdown,
        totalsWindowDays: summary?.totalsWindowDays,
        totalsTruncated: summary?.totalsTruncated,
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
