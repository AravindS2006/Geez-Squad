import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loggedRoute } from '@/lib/request-log';
import { ApiError, requireUser, safeError } from '@/lib/security';
import { coachTraineeWhere, requireStudio } from '@/lib/studio-access';
import { parseJournal } from '@/lib/daily-check-in';
import { studioToday } from '@/lib/studio-operations';
import {
  REGISTER_DAYS,
  registerDate,
  registerRows,
  registerSummary,
  studioDayRange,
} from '@/lib/check-in-register';

/** The coach's daily check-in register: one row per trainee they may follow, for one day. */
async function get(request: Request) {
  try {
    const actor = await requireUser();
    const date = registerDate(new URL(request.url).searchParams.get('date'));
    if (!date) throw new ApiError(400, `Choose a date within the last ${REGISTER_DAYS} days.`);
    const { start, end } = studioDayRange(date);
    return await db.$transaction(async (tx) => {
      const access = await requireStudio(actor.id, 'coach', undefined, tx);
      const members = await tx.studioMember.findMany({
        where: coachTraineeWhere(access.studio.id, actor.id, access.admin),
        include: { primaryCoach: true },
      });
      const entries = members.length
        ? await tx.checkIn.findMany({
            where: {
              createdAt: { gte: start, lt: end },
              // A coach sees only what was shared since their current assignment began.
              OR: members.map((m) => ({
                userId: m.userId!,
                ...(access.admin ? {} : { createdAt: { gte: m.primaryCoach!.assignedAt } }),
              })),
            },
            orderBy: { createdAt: 'desc' },
            take: 1000,
          })
        : [];
      const names = new Map(members.map((m) => [m.userId!, m.name]));
      const rows = registerRows(
        members.map((m) => ({ id: m.userId!, name: m.name })),
        entries.map((entry) => ({
          ...entry,
          userName: names.get(entry.userId) ?? '',
          journal: parseJournal(entry.journal),
          createdAt: entry.createdAt.toISOString(),
        })),
        date,
      );
      return NextResponse.json(
        { date, today: studioToday(), rows, summary: registerSummary(rows) },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    });
  } catch (e) {
    return safeError(e);
  }
}
export const GET = loggedRoute('/api/check-ins', get);
