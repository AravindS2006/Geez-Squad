/**
 * Bucket observed active training time into calendar days (or ISO-ish weeks for
 * long ranges) in the viewer's time zone. Only sums what was recorded; empty
 * buckets stay zero rather than being interpolated.
 */
export type ActivityBucket = { key: string; label: string; minutes: number; sets: number };

const dayKey = (time: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);

export function activitySeries(
  sets: { endedAt: string; activeMs: number }[],
  days: number,
  timeZone: string,
  now = Date.now(),
): ActivityBucket[] {
  const weekly = days > 60;
  const span = weekly ? Math.min(52, Math.ceil(days / 7)) : days;
  const step = weekly ? 7 : 1;
  const label = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' });
  const buckets: ActivityBucket[] = [];
  const index = new Map<string, number>();
  for (let i = span - 1; i >= 0; i--) {
    const time = now - i * step * 86400000;
    const key = dayKey(time, timeZone);
    buckets.push({ key, label: label.format(time), minutes: 0, sets: 0 });
    // Map every day of the bucket's window to this bucket.
    for (let d = 0; d < step; d++)
      index.set(dayKey(time - d * 86400000, timeZone), buckets.length - 1);
  }
  for (const set of sets) {
    const at = Date.parse(set.endedAt);
    if (!Number.isFinite(at)) continue;
    const slot = index.get(dayKey(at, timeZone));
    if (slot === undefined) continue;
    buckets[slot].minutes += set.activeMs / 60000;
    buckets[slot].sets += 1;
  }
  return buckets.map((b) => ({ ...b, minutes: Math.round(b.minutes * 10) / 10 }));
}
