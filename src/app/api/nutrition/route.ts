import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loggedRoute } from '@/lib/request-log';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { nutritionCommandSchema, emptyNutritionProfile } from '@/lib/nutrition';
import { requireNutritionAccess } from '@/lib/nutrition-access';
import { addDays, studioToday } from '@/lib/studio-operations';
async function get(request: Request) {
  try {
    const actor = await requireUser();
    const params = new URL(request.url).searchParams;
    const userId = params.get('userId') || actor.id;
    const date = params.get('date') || studioToday();
    if (
      userId.length > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new ApiError(400, 'Choose a valid journal date.');
    return await db.$transaction(async (tx) => {
      await requireNutritionAccess(actor.id, userId, tx);
      const [profile, entries] = await Promise.all([
        tx.nutritionProfile.findUnique({ where: { userId } }),
        tx.nutritionEntry.findMany({
          where: { userId, date: { gte: addDays(date, -6), lte: date } },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 701,
        }),
      ]);
      return NextResponse.json(
        { profile: profile ?? emptyNutritionProfile, entries, canEditJournal: actor.id === userId },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    });
  } catch (e) {
    return safeError(e);
  }
}
async function post(request: Request) {
  try {
    const actor = await requireUser();
    const c = nutritionCommandSchema.parse(await readJson(request));
    await rateLimit(actor.id, 'nutrition', 60);
    await db.$transaction(
      async (tx) => {
        const userId = c.action === 'targets' ? c.userId : actor.id;
        await requireNutritionAccess(actor.id, userId, tx);
        if (c.action === 'entry') {
          if (c.entry.date > studioToday() || c.entry.date < addDays(studioToday(), -366))
            throw new ApiError(400, 'Log a date within the last year.');
          const existing = await tx.nutritionEntry.findUnique({ where: { id: c.entry.id } });
          if (existing && existing.userId !== actor.id)
            throw new ApiError(404, 'Entry unavailable.');
          if (
            (!existing || existing.date !== c.entry.date) &&
            (await tx.nutritionEntry.count({ where: { userId, date: c.entry.date } })) >= 100
          )
            throw new ApiError(409, 'Daily journal limit reached.');
          await tx.nutritionEntry.upsert({
            where: { id: c.entry.id },
            create: { ...c.entry, userId },
            update: c.entry,
          });
        } else if (c.action === 'remove') {
          await tx.nutritionEntry.deleteMany({ where: { id: c.id, userId } });
        } else if (c.action === 'sharing') {
          await tx.nutritionProfile.upsert({
            where: { userId },
            create: { userId, updatedById: actor.id, shareWithCoach: c.shareWithCoach },
            update: { shareWithCoach: c.shareWithCoach, updatedById: actor.id },
          });
        } else {
          await tx.nutritionProfile.upsert({
            where: { userId },
            create: { userId, updatedById: actor.id, ...c.profile },
            update: { ...c.profile, updatedById: actor.id },
          });
        }
        await tx.auditEvent.create({
          data: { actorId: actor.id, targetId: userId, action: `nutrition.${c.action}` },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return safeError(e);
  }
}
export const GET = loggedRoute('/api/nutrition', get);
export const POST = loggedRoute('/api/nutrition', post);
