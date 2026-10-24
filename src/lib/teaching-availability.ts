import 'server-only';
import type { Prisma } from '@prisma/client';
import { classOverlap } from './studio-operations';
import { ApiError } from './security';
export async function requirePhysicalClassAvailability(
  tx: Prisma.TransactionClient,
  studioId: string,
  hostId: string,
  startsAt: string,
  duration: number,
) {
  const candidates = await tx.studioClass.findMany({
    where: {
      studioId,
      hostId,
      status: 'scheduled',
      startsAt: {
        gt: new Date(Date.parse(startsAt) - 240 * 60000),
        lt: new Date(Date.parse(startsAt) + duration * 60000),
      },
    },
  });
  if (candidates.some((item) => classOverlap({ startsAt, duration }, item)))
    throw new ApiError(
      409,
      'This trainer already has an overlapping studio class. Choose another time or trainer.',
    );
}
