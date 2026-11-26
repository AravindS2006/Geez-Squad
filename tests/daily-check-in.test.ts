import { describe, it, expect } from 'vitest';
import {
  checkInJournalSchema,
  clockLabel,
  clockMinutes,
  emptyJournal,
  isEmptyJournal,
  journalSummary,
  normalizeJournal,
  parseJournal,
  shouldOpenDailyCheckIn,
} from '../src/lib/daily-check-in';
import { commandSchema } from '../src/lib/validation';

// 2026-11-26 09:00 in India (03:30 UTC).
const now = new Date('2026-11-26T03:30:00.000Z');

describe('shouldOpenDailyCheckIn', () => {
  it('opens on the first visit of the studio day', () => {
    expect(shouldOpenDailyCheckIn({ userId: 'u1', checkIns: [], skippedDay: null, now })).toBe(
      true,
    );
  });
  it('opens at most once per studio day, even when dismissed', () => {
    expect(
      shouldOpenDailyCheckIn({ userId: 'u1', checkIns: [], skippedDay: '2026-11-26', now }),
    ).toBe(false);
    expect(
      shouldOpenDailyCheckIn({ userId: 'u1', checkIns: [], skippedDay: '2026-11-25', now }),
    ).toBe(true);
  });
  it('stays closed after a check-in earlier in the same India day', () => {
    // 2026-11-25T19:00Z is 00:30 on the 26th in India.
    const checkIns = [{ userId: 'u1', createdAt: '2026-11-25T19:00:00.000Z' }];
    expect(shouldOpenDailyCheckIn({ userId: 'u1', checkIns, skippedDay: null, now })).toBe(false);
  });
  it('ignores yesterday and other people', () => {
    const checkIns = [
      { userId: 'u1', createdAt: '2026-11-25T18:00:00.000Z' },
      { userId: 'u2', createdAt: '2026-11-26T03:00:00.000Z' },
    ];
    expect(shouldOpenDailyCheckIn({ userId: 'u1', checkIns, skippedDay: null, now })).toBe(true);
  });
});

describe('journal answers', () => {
  it('drops follow-ups for questions not answered yes', () => {
    expect(
      normalizeJournal({
        ...emptyJournal,
        sunlight: false,
        sunlightMinutes: 10,
        sunlightAt: '07:00',
        caffeine: true,
        caffeineServings: 2,
        caffeineLastAt: '14:30',
        alcohol: null,
        alcoholDrinks: 3,
      }),
    ).toMatchObject({
      sunlightMinutes: null,
      sunlightAt: null,
      caffeineServings: 2,
      caffeineLastAt: '14:30',
      alcoholDrinks: null,
    });
  });
  it('rejects unknown keys, bad times and out-of-range counts', () => {
    expect(checkInJournalSchema.safeParse({ ...emptyJournal, extra: 1 }).success).toBe(false);
    expect(checkInJournalSchema.safeParse({ ...emptyJournal, sunlightAt: '24:00' }).success).toBe(
      false,
    );
    expect(checkInJournalSchema.safeParse({ ...emptyJournal, caffeineServings: 0 }).success).toBe(
      false,
    );
  });
  it('reads legacy rows without a journal as none', () => {
    expect(parseJournal(null)).toBeNull();
    expect(parseJournal('nonsense')).toBeNull();
    expect(parseJournal(emptyJournal)).toEqual(emptyJournal);
    expect(isEmptyJournal(emptyJournal)).toBe(true);
  });
  it('summarises answered questions only', () => {
    expect(journalSummary(null)).toBe('');
    expect(
      journalSummary({
        ...emptyJournal,
        sunlight: true,
        sunlightMinutes: 15,
        sunlightAt: '07:30',
        stress: false,
        caffeine: true,
        caffeineServings: 2,
        caffeineLastAt: '18:30',
        hydrated: true,
      }),
    ).toBe('Morning sunlight 15 min at 07:30 · No stress · Caffeine 2 last at 18:30 · Hydrated');
  });
  it('converts clock times both ways', () => {
    expect(clockLabel(9 * 60)).toBe('09:00');
    expect(clockLabel(1439)).toBe('23:59');
    expect(clockMinutes('18:30')).toBe(1110);
  });
});

describe('checkIn command', () => {
  const base = {
    action: 'checkIn',
    energy: 3,
    soreness: 1,
    effort: null,
    sleepHours: 7,
    bodyweightKg: null,
    note: '',
  };
  it('still accepts a check-in without a journal', () => {
    expect(commandSchema.parse(base)).toMatchObject({ journal: null });
  });
  it('accepts a journal', () => {
    expect(
      commandSchema.parse({ ...base, journal: { ...emptyJournal, stress: true } }),
    ).toMatchObject({
      journal: { stress: true },
    });
  });
});
