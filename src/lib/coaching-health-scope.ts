import 'server-only';
import type { Prisma } from '@prisma/client';
import { participation } from './member-access';
import { studioAccess } from './studio-access';

export type HealthScope = { studioId?: string; classId?: string };
type Store = Pick<
  Prisma.TransactionClient,
  | 'classSession'
  | 'enrollment'
  | 'studio'
  | 'studioRoleGrant'
  | 'studioMember'
  | 'membership'
  | 'memberTerm'
  | 'primaryCoachAssignment'
>;

/**
 * The studio and class ids a health event may be logged with. The client only names a
 * class; the ids are logged only when the signed-in user is an enrolled, participating
 * trainee of that class or a coach or admin of its studio. Anything else is logged
 * without ids, so a caller cannot attach events to (or probe) classes it cannot see.
 */
export async function healthScope(
  userId: string,
  classId: string | undefined,
  store: Store,
): Promise<HealthScope> {
  if (!classId) return {};
  const item = await store.classSession.findUnique({
    where: { id: classId },
    select: { id: true, studioId: true },
  });
  if (!item) return {};
  const scope = { studioId: item.studioId, classId: item.id };
  const enrollment = await store.enrollment.findUnique({
    where: { classId_userId: { classId: item.id, userId } },
    select: { userId: true },
  });
  if (enrollment && (await participation(item.studioId, userId, undefined, store)).allowed)
    return scope;
  const access = await studioAccess(userId, item.studioId, store);
  return access && access.studio.id === item.studioId && (access.admin || access.coach)
    ? scope
    : {};
}
