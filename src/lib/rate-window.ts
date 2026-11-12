/**
 * In-process fixed windows for rate limiting. They never replace the shared database
 * limiter for abuse protection across instances; they only let one instance skip
 * database work it already knows the answer to.
 */
export class FixedWindows {
  private entries = new Map<string, { until: number; count: number }>();
  constructor(private readonly maxEntries = 10_000) {}

  /** Count one call for `key` in the window ending at `until`; returns the new count. */
  hit(key: string, until: number, now = Date.now()) {
    const entry = this.entries.get(key);
    const count = entry && entry.until > now ? entry.count + 1 : 1;
    this.entries.set(key, { until, count });
    this.prune(now);
    return count;
  }

  /** Remember that `key` is over its limit until `until`. */
  block(key: string, until: number, now = Date.now()) {
    this.entries.set(key, { until, count: Number.POSITIVE_INFINITY });
    this.prune(now);
  }

  blocked(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    return !!entry && entry.until > now && entry.count === Number.POSITIVE_INFINITY;
  }

  clear() {
    this.entries.clear();
  }

  private prune(now: number) {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) if (entry.until <= now) this.entries.delete(key);
    // Still full of live windows: drop the oldest insertions rather than grow unbounded.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}

/**
 * The live room shares a summary at most every ~2.8 s (changed) or 9 s (heartbeat).
 * A summary arriving at least this long after the enrollment's last stored summary is
 * normal cadence: at most 30 such writes a minute can exist, the shared limit, so it
 * needs no RateLimit row. Anything faster is charged to the shared database limiter.
 * The previous write time comes from the Metric row the metrics transaction already
 * loads, so the bound holds across instances.
 */
export const METRIC_STEADY_INTERVAL_MS = 2000;
export function metricNeedsSharedLimit(previousUpdatedAt: Date | null | undefined, now: number) {
  return !previousUpdatedAt || now - previousUpdatedAt.getTime() < METRIC_STEADY_INTERVAL_MS;
}

export function fixedWindow(now: number, windowMs: number) {
  const bucket = Math.floor(now / windowMs);
  return { bucket, until: (bucket + 1) * windowMs };
}
