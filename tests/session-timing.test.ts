import { describe, expect, it } from 'vitest';
import {
  compareSessions,
  localDateTime,
  parseSessionTime,
  sessionElapsedSeconds,
} from '../src/lib/session-timing';

const session = {
  status: 'live',
  startsAt: '2026-10-13T10:00:00Z',
  startedAt: '2026-10-13T10:05:00Z',
  endedAt: null,
  duration: 30,
};
describe('meeting timing', () => {
  it('starts from the actual start, not the scheduled start', () => {
    expect(sessionElapsedSeconds(session, Date.parse('2026-10-13T10:10:00Z'))).toBe(300);
    expect(sessionElapsedSeconds({ ...session, startedAt: null }, Date.now())).toBe(0);
  });
  it('freezes completed meetings and never labels a terminal session as still ticking', () => {
    expect(
      sessionElapsedSeconds(
        { ...session, status: 'completed', endedAt: '2026-10-13T10:25:00Z' },
        Date.parse('2026-10-14T12:00:00Z'),
      ),
    ).toBe(1200);
    expect(sessionElapsedSeconds({ ...session, status: 'cancelled' }, Date.now())).toBe(0);
  });
  it('clamps negative elapsed time while a device clock catches up', () => {
    expect(sessionElapsedSeconds(session, Date.parse('2026-10-13T10:04:00Z'))).toBe(0);
  });
  it('keeps live meetings ahead of overdue schedules and history newest first', () => {
    const values = [
      { status: 'completed', startsAt: '2026-10-01' },
      { status: 'scheduled', startsAt: '2026-10-02' },
      { status: 'live', startsAt: '2026-10-13' },
      { status: 'completed', startsAt: '2026-10-12' },
    ].sort(compareSessions);
    expect(values.map((s) => s.startsAt)).toEqual([
      '2026-10-13',
      '2026-10-02',
      '2026-10-12',
      '2026-10-01',
    ]);
  });
  it('preserves the exact instant when editing only session metadata', () => {
    const original = '2026-11-01T06:30:45.123Z';
    expect(parseSessionTime(localDateTime(new Date(original)), original)).toBe(original);
  });
  it('rejects empty, malformed, and overflow dates without throwing', () => {
    for (const value of ['', 'bad', '2026-02-30T10:00', '2026-10-13T25:00'])
      expect(parseSessionTime(value)).toBeNull();
  });
});
