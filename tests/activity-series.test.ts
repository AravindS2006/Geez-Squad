import { describe, expect, it } from 'vitest';
import { activitySeries } from '../src/lib/activity-series';

const now = Date.parse('2026-11-09T12:00:00Z');
describe('activitySeries', () => {
  it('returns one zeroed bucket per day for short ranges', () => {
    const series = activitySeries([], 7, 'UTC', now);
    expect(series).toHaveLength(7);
    expect(series.every((b) => b.minutes === 0 && b.sets === 0)).toBe(true);
    expect(series.at(-1)?.key).toBe('2026-11-09');
  });
  it('sums observed active time into the viewer time zone day', () => {
    const sets = [
      { endedAt: '2026-11-08T20:00:00Z', activeMs: 120000 }, // 9 Nov in Kolkata
      { endedAt: '2026-11-09T05:00:00Z', activeMs: 60000 },
    ];
    const series = activitySeries(sets, 7, 'Asia/Kolkata', now);
    expect(series.at(-1)).toMatchObject({ minutes: 3, sets: 2 });
  });
  it('groups long ranges into weeks and ignores records outside the window', () => {
    const series = activitySeries(
      [
        { endedAt: '2026-11-03T10:00:00Z', activeMs: 60000 },
        { endedAt: '2024-01-01T10:00:00Z', activeMs: 60000 },
      ],
      90,
      'UTC',
      now,
    );
    expect(series).toHaveLength(13);
    expect(series.reduce((sum, b) => sum + b.sets, 0)).toBe(1);
    expect(series.at(-1)?.sets).toBe(1);
  });
});
