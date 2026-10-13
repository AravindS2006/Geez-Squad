import { fetchJson } from './client';
import type { WorkoutSetRecord } from './types';
import { readBrowserPreference } from './browser-preferences';
const key = 'geez-squad:pending-sets:v1';
type Pending = { userId: string; record: WorkoutSetRecord };
function read(): Pending[] {
  try {
    const value = JSON.parse(readBrowserPreference(key) || '[]');
    return Array.isArray(value)
      ? value.filter(
          (item) =>
            item &&
            typeof item.userId === 'string' &&
            item.record &&
            typeof item.record.clientId === 'string',
        )
      : [];
  } catch {
    return [];
  }
}
function write(values: Pending[]) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* The current set still remains available for retry on the page. */
  }
}
export async function saveWorkoutSet(userId: string, record: WorkoutSetRecord) {
  const pending = read();
  if (!pending.some((item) => item.userId === userId && item.record.clientId === record.clientId))
    write([...pending, { userId, record }]);
  await fetchJson('/api/workout-sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...record, ownerId: userId }),
    keepalive: true,
  });
  write(
    read().filter((item) => !(item.userId === userId && item.record.clientId === record.clientId)),
  );
}
export async function retryWorkoutSets(userId: string) {
  let saved = 0;
  let failed = 0;
  for (const item of read().filter((entry) => entry.userId === userId)) {
    try {
      await saveWorkoutSet(userId, item.record);
      saved++;
    } catch {
      failed++;
    }
  }
  if (failed) throw new Error(`${failed} workout saves are still pending.`);
  return saved;
}
export function pendingWorkoutSets(userId: string) {
  return read().filter((entry) => entry.userId === userId).length;
}
