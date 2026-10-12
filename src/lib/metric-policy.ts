/** Bound cumulative progress by elapsed server time, including a delayed first
 * delivery. A fixed first-packet allowance permanently rejects offline work. */
export function metricElapsedSeconds(
  now: number,
  startedAt: Date | null,
  consentAt: Date,
  previousUpdatedAt?: Date,
) {
  const baseline =
    previousUpdatedAt?.getTime() ??
    Math.max(startedAt?.getTime() ?? consentAt.getTime(), consentAt.getTime());
  return Math.max(0, (now - baseline) / 1000);
}
