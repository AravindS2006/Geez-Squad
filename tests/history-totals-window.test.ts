import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({ ApiError: class extends Error {} }));
vi.mock('@/lib/studio-access', () => ({ studioAccess: vi.fn() }));
const findMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { workoutSet: { findMany } } }));
import { HISTORY_TOTALS_MAX_DAYS, historyTotals } from '../src/lib/workout-history';

const now = Date.parse('2026-11-09T12:00:00Z');
const row = (id: string, endedAt: string, overrides: Record<string, unknown> = {}) => ({
  id,
  clientId: id,
  userId: 'trainee',
  classId: null,
  revision: 0,
  exercise: 'squat',
  ruleVersion: 'v1',
  setNumber: 1,
  target: 10,
  reps: 10,
  holdMs: 0,
  activeMs: 30000,
  trackedMs: 30000,
  formScore: 80,
  qualityScore: 90,
  rangeDegrees: null,
  repSeconds: null,
  confidence: null,
  rejectedReps: 0,
  loadKg: null,
  completed: true,
  startedAt: new Date(Date.parse(endedAt) - 30000),
  endedAt: new Date(endedAt),
  createdAt: new Date(endedAt),
  measurement: null,
  corrections: [],
  ...overrides,
});
type Where = { AND: [{ AND: [unknown, { endedAt: { gte: Date } }] }, unknown] };
beforeEach(() => findMany.mockReset());
describe('history totals', () => {
  it('caps the totals window at one year and applies corrections', async () => {
    findMany.mockResolvedValueOnce([
      row('b', '2026-11-08T10:00:00Z', {
        corrections: [
          { reps: 6, holdMs: 0, reason: 'miscount', actorId: 'coach', createdAt: new Date() },
        ],
      }),
      row('a', '2026-11-01T10:00:00Z'),
    ]);
    const result = await historyTotals({ userId: 'trainee' }, 'UTC', { days: 36500, now });
    const where = findMany.mock.calls[0][0].where as Where;
    expect(where.AND[0].AND[1].endedAt.gte.getTime()).toBe(
      now - HISTORY_TOTALS_MAX_DAYS * 86400000,
    );
    // Names and class titles are not loaded for aggregation.
    expect(findMany.mock.calls[0][0].include).not.toHaveProperty('user');
    expect(result.totalsWindowDays).toBe(365);
    expect(result.totals.reps).toBe(16);
    expect(result.totals.sets).toBe(2);
    expect(result.totals.completedSets).toBe(1);
    expect(result.totals.trainingDays).toBe(2);
    expect(result.byUser.trainee.reps).toBe(16);
    expect(result.breakdown).toHaveLength(1);
    expect(result.totalsTruncated).toBe(false);
  });
  it('keeps shorter requested ranges and stops at the row ceiling', async () => {
    findMany.mockImplementation(async (args?: { take: number }) =>
      Array.from({ length: args?.take ?? 0 }, (_, i) =>
        row(`r${i}`, new Date(now - (i + 1) * 60000).toISOString()),
      ),
    );
    const result = await historyTotals({ userId: 'trainee' }, 'UTC', {
      days: 30,
      now,
      maxRows: 3,
    });
    const where = findMany.mock.calls[0][0].where as Where;
    expect(where.AND[0].AND[1].endedAt.gte.getTime()).toBe(now - 30 * 86400000);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.totals.sets).toBe(3);
    expect(result.totalsTruncated).toBe(true);
  });
  it('pages large windows with a keyset cursor', async () => {
    const first = Array.from({ length: 1001 }, (_, i) =>
      row(`p${String(9999 - i)}`, new Date(now - (i + 1) * 1000).toISOString()),
    );
    findMany
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([row('last', '2026-10-01T00:00:00Z')]);
    const result = await historyTotals({ userId: 'trainee' }, 'UTC', { days: 90, now });
    expect(findMany).toHaveBeenCalledTimes(2);
    const tail = first[999];
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({
      OR: [{ endedAt: { lt: tail.endedAt } }, { endedAt: tail.endedAt, id: { lt: tail.id } }],
    });
    expect(result.totals.sets).toBe(1001);
    expect(result.totalsTruncated).toBe(false);
  });
});
