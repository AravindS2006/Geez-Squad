import { describe, expect, it } from 'vitest';
import {
  journalCells,
  registerDate,
  registerRows,
  registerSummary,
  studioDayRange,
} from '../src/lib/check-in-register';
import { emptyJournal } from '../src/lib/daily-check-in';
import type { CheckInView } from '../src/lib/types';

const now = new Date('2026-11-26T06:00:00Z'); // 11:30 in India
function entry(userId: string, createdAt: string, patch: Partial<CheckInView> = {}): CheckInView {
  return {
    id: `${userId}-${createdAt}`,
    userId,
    userName: userId,
    energy: 3,
    soreness: 1,
    effort: null,
    sleepHours: null,
    bodyweightKg: null,
    note: '',
    journal: null,
    createdAt,
    ...patch,
  };
}

describe('registerDate', () => {
  it('defaults to the studio day and accepts the last 30 days', () => {
    expect(registerDate(null, now)).toBe('2026-11-26');
    expect(registerDate('2026-10-27', now)).toBe('2026-10-27');
  });
  it('rejects future, too old and malformed dates', () => {
    for (const value of ['2026-11-27', '2026-10-26', '2026-02-30', '26-11-2026', 'x'])
      expect(registerDate(value, now)).toBeNull();
  });
});

describe('studioDayRange', () => {
  it('covers India midnight to midnight', () => {
    const { start, end } = studioDayRange('2026-11-26');
    expect(start.toISOString()).toBe('2026-11-25T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-26T18:30:00.000Z');
  });
});

describe('registerRows', () => {
  const trainees = [
    { id: 'b', name: 'Bala' },
    { id: 'a', name: 'Anu' },
  ];
  it('lists every trainee A to Z, with only that studio day, newest first', () => {
    const rows = registerRows(
      trainees,
      [
        entry('a', '2026-11-26T01:00:00Z'),
        entry('a', '2026-11-26T05:00:00Z'),
        // 23:59 India time on the previous day.
        entry('b', '2026-11-25T18:29:00Z'),
        entry('stranger', '2026-11-26T05:00:00Z'),
      ],
      '2026-11-26',
    );
    expect(rows.map((row) => row.name)).toEqual(['Anu', 'Bala']);
    expect(rows[0].checkIns.map((c) => c.createdAt)).toEqual([
      '2026-11-26T05:00:00Z',
      '2026-11-26T01:00:00Z',
    ]);
    expect(rows[1].checkIns).toEqual([]);
    expect(registerSummary(rows)).toEqual({ checkedIn: 1, total: 2 });
  });
});

describe('journalCells', () => {
  it('shows skipped answers as a dash for older check-ins', () => {
    expect(journalCells(null)).toEqual({
      sunlight: '—',
      stress: '—',
      alcohol: '—',
      caffeine: '—',
      hydrated: '—',
    });
  });
  it('puts each answer and its follow-ups in its own cell', () => {
    expect(
      journalCells({
        ...emptyJournal,
        sunlight: true,
        sunlightMinutes: 20,
        sunlightAt: '07:15',
        stress: false,
        alcohol: true,
        alcoholDrinks: 1,
        caffeine: true,
        caffeineServings: 2,
        caffeineLastAt: '14:00',
        hydrated: true,
      }),
    ).toEqual({
      sunlight: 'Yes · 20 min · at 07:15',
      stress: 'No',
      alcohol: 'Yes · 1 drink',
      caffeine: 'Yes · 2 servings · last 14:00',
      hydrated: 'Yes',
    });
  });
});
