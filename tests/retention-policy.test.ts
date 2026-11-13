import { describe, expect, it, vi } from 'vitest';
import {
  AUDIT_EVENT_RETENTION_DAYS,
  auditRetentionDays,
  DAY_MS,
  pruneInBatches,
  retentionCutoff,
} from '../src/lib/retention-policy';

describe('auditRetentionDays', () => {
  it('defaults to 400 days when unset, blank or invalid', () => {
    for (const raw of [undefined, '', '  ', 'abc', '365.5', '-1'])
      expect(auditRetentionDays(raw)).toBe(AUDIT_EVENT_RETENTION_DAYS);
  });
  it('ignores values below the 90-day floor', () => {
    expect(auditRetentionDays('89')).toBe(AUDIT_EVENT_RETENTION_DAYS);
    expect(auditRetentionDays('0')).toBe(AUDIT_EVENT_RETENTION_DAYS);
  });
  it('accepts a whole number at or above the floor', () => {
    expect(auditRetentionDays('90')).toBe(90);
    expect(auditRetentionDays('2555')).toBe(2555);
  });
});

it('retentionCutoff subtracts whole days', () => {
  const now = new Date('2026-11-13T03:00:00Z');
  expect(retentionCutoff(now, 30).getTime()).toBe(now.getTime() - 30 * DAY_MS);
});

/** In-memory table of expired IDs, deleted oldest first. */
function table(count: number) {
  const rows = Array.from({ length: count }, (_, i) => `row-${i}`);
  const findIds = vi.fn(async (limit: number) => rows.slice(0, limit));
  const deleteIds = vi.fn(async (ids: string[]) => {
    const before = rows.length;
    rows.splice(0, rows.length, ...rows.filter((id) => !ids.includes(id)));
    return before - rows.length;
  });
  return { rows, findIds, deleteIds };
}

describe('pruneInBatches', () => {
  it('stops after a short batch once the backlog is cleared', async () => {
    const t = table(25);
    const result = await pruneInBatches(t.findIds, t.deleteIds, { batchSize: 10 });
    expect(result).toEqual({ deleted: 25, complete: true });
    expect(t.findIds).toHaveBeenCalledTimes(3);
    expect(t.rows).toHaveLength(0);
  });
  it('does not call delete when nothing is expired', async () => {
    const t = table(0);
    expect(await pruneInBatches(t.findIds, t.deleteIds)).toEqual({ deleted: 0, complete: true });
    expect(t.deleteIds).not.toHaveBeenCalled();
  });
  it('caps the number of batches per run and leaves the rest for the next run', async () => {
    const t = table(100);
    const result = await pruneInBatches(t.findIds, t.deleteIds, { batchSize: 10, maxBatches: 3 });
    expect(result).toEqual({ deleted: 30, complete: false });
    expect(t.rows).toHaveLength(70);
  });
  it('stops at the deadline but always runs the first batch', async () => {
    const t = table(100);
    let now = 1_000;
    const clock = () => (now += 600);
    const result = await pruneInBatches(t.findIds, t.deleteIds, {
      batchSize: 10,
      deadline: 1_000,
      clock,
    });
    expect(result).toEqual({ deleted: 10, complete: false });
  });
  it('treats an exactly full final batch as possibly incomplete and checks again', async () => {
    const t = table(20);
    const result = await pruneInBatches(t.findIds, t.deleteIds, { batchSize: 10 });
    expect(result).toEqual({ deleted: 20, complete: true });
    expect(t.findIds).toHaveBeenCalledTimes(3);
  });
});
