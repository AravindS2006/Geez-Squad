/**
 * Retention windows and bounded pruning for the daily retention job
 * (`/api/retention`). Pure: the route passes the database calls in.
 *
 * - WebhookEvent rows only exist for billing-webhook idempotency. Stripe retries a
 *   failed delivery for up to 3 days, so 30 days keeps every replay deduplicated.
 * - AuditEvent rows (IDs and action names only) are kept 400 days by default, a bit
 *   over a year so a full annual review cycle stays traceable. `AUDIT_RETENTION_DAYS`
 *   may lengthen it; values below the 90-day floor or not whole numbers are ignored.
 *   No flow reads audit events to decide anything: they back the booking history in
 *   My bookings and the data export, which then show only the retained window.
 */
export const DAY_MS = 86_400_000;
export const WEBHOOK_EVENT_RETENTION_DAYS = 30;
export const AUDIT_EVENT_RETENTION_DAYS = 400;
export const AUDIT_EVENT_MIN_RETENTION_DAYS = 90;
/** Rows deleted per statement; keeps each `IN (...)` list and lock window small. */
export const PRUNE_BATCH_SIZE = 500;
/** Batches per table per run; the backlog continues on the next daily run. */
export const PRUNE_MAX_BATCHES = 20;
/** Wall-clock budget shared by all pruned tables in one run, well inside the route's
 * `maxDuration` (60 s) so the abandoned-class sweep that follows still runs. */
export const PRUNE_TIME_BUDGET_MS = 20_000;

export function auditRetentionDays(raw: string | undefined): number {
  const value = Number(raw);
  if (!raw?.trim() || !Number.isInteger(value) || value < AUDIT_EVENT_MIN_RETENTION_DAYS)
    return AUDIT_EVENT_RETENTION_DAYS;
  return value;
}

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export type PruneResult = { deleted: number; complete: boolean };

/**
 * Delete rows older than the cutoff in bounded batches. `findIds` returns up to
 * `limit` IDs of the oldest expired rows; `deleteIds` deletes exactly those rows
 * and returns the count. Stops when a batch comes back short (backlog cleared),
 * after `maxBatches`, or once `deadline` (epoch ms) has passed. The first batch
 * always runs so a slow earlier table cannot starve a later one forever.
 */
export async function pruneInBatches(
  findIds: (limit: number) => Promise<string[]>,
  deleteIds: (ids: string[]) => Promise<number>,
  {
    batchSize = PRUNE_BATCH_SIZE,
    maxBatches = PRUNE_MAX_BATCHES,
    deadline = Number.POSITIVE_INFINITY,
    clock = Date.now,
  }: { batchSize?: number; maxBatches?: number; deadline?: number; clock?: () => number } = {},
): Promise<PruneResult> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    if (batch > 0 && clock() >= deadline) return { deleted, complete: false };
    const ids = await findIds(batchSize);
    if (ids.length) deleted += await deleteIds(ids);
    if (ids.length < batchSize) return { deleted, complete: true };
  }
  return { deleted, complete: false };
}
