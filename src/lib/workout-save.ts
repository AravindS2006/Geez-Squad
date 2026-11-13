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
/** Saves in flight per owner and record, so overlapping triggers share one request. */
const inFlight = new Map<string, Promise<void>>();
const retries = new Map<string, Promise<number>>();
export function saveWorkoutSet(userId: string, record: WorkoutSetRecord) {
  const id = JSON.stringify([userId, record.clientId]);
  const running = inFlight.get(id);
  if (running) return running;
  const request = sendWorkoutSet(userId, record).finally(() => inFlight.delete(id));
  inFlight.set(id, request);
  return request;
}
async function sendWorkoutSet(userId: string, record: WorkoutSetRecord) {
  const pending = read();
  if (!pending.some((item) => item.userId === userId && item.record.clientId === record.clientId))
    write([...pending, { userId, record }]);
  // The server upserts by (user, clientId), so a repeated request never duplicates a set.
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
/** Resends queued sets for one owner. Concurrent calls share the same pass. */
export function retryWorkoutSets(userId: string) {
  const running = retries.get(userId);
  if (running) return running;
  const pass = retryPass(userId).finally(() => retries.delete(userId));
  retries.set(userId, pass);
  return pass;
}
async function retryPass(userId: string) {
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
/**
 * Whether an automatic retry is worth trying now: something is queued, the browser
 * does not report itself offline and the page is visible.
 */
export function shouldAutoRetry(
  userId: string | undefined,
  env: { online: boolean; hidden: boolean },
) {
  return !!userId && env.online && !env.hidden && pendingWorkoutSets(userId) > 0;
}
export function pendingWorkoutSets(userId: string) {
  return read().filter((entry) => entry.userId === userId).length;
}
