import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { studioAccess } from './studio-access';
import { ApiError } from './security';
export async function requireNutritionAccess(
  actorId: string,
  userId: string,
  store: Prisma.TransactionClient = db,
) {
  if (actorId === userId) return;
  const access = await studioAccess(actorId, undefined, store);
  const member =
    access?.coach &&
    (await store.studioMember.findFirst({
      where: {
        studioId: access.studio.id,
        userId,
        status: 'active',
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
    }));
  const profile = member ? await store.nutritionProfile.findUnique({ where: { userId } }) : null;
  if (!profile?.shareWithCoach)
    throw new ApiError(404, 'This nutrition journal is not shared with you.');
}
