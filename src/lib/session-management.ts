import { createHash } from 'node:crypto';

type EditableSession = {
  id: string;
  title: string;
  startsAt: Date | string;
  duration: number;
  capacity: number;
  status: string;
  revision: number;
  planId: string | null;
  enrollments: { userId: string }[];
};

/** Includes the roster so two open editors cannot silently overwrite each other. */
export function sessionEditVersion(item: EditableSession) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.id,
        item.title,
        new Date(item.startsAt).toISOString(),
        item.duration,
        item.capacity,
        item.status,
        item.revision,
        item.planId,
        item.enrollments.map((entry) => entry.userId).sort(),
      ]),
    )
    .digest('hex');
}
