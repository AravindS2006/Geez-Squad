import { describe, it, expect } from 'vitest';
import {
  addDays,
  ATTENDANCE_DAYS,
  applyDemoOperation,
  currentTerm,
  demoOperations,
  operationsSchema,
  outstanding,
  studioToday,
  termStatus,
  validateTerm,
  weeklyOccurrences,
  MAX_REPEAT_WEEKS,
} from '../src/lib/studio-operations';

describe('studio membership lifecycle', () => {
  it('uses India calendar dates and inclusive membership durations', () => {
    expect(studioToday(new Date('2026-10-18T20:00:00Z'))).toBe('2026-10-19');
    expect(addDays('2028-02-01', 29)).toBe('2028-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('calculates statuses across start and end boundaries', () => {
    const t = { ...demoOperations().terms[0], startsOn: '2026-10-01', endsOn: '2026-10-30' };
    expect(termStatus(t, '2026-09-30')).toBe('upcoming');
    expect(termStatus(t, '2026-10-01')).toBe('active');
    expect(termStatus(t, '2026-10-30')).toBe('active');
    expect(termStatus(t, '2026-10-31')).toBe('expired');
    expect(termStatus({ ...t, status: 'cancelled' }, '2026-10-19')).toBe('cancelled');
  });
  it('rejects overlapping terms but permits a next-day renewal with a price snapshot', () => {
    const d = demoOperations(),
      term = d.terms[0];
    expect(() => validateTerm(d, term.memberId, term.offerId, term.endsOn)).toThrow('overlaps');
    const next = applyDemoOperation(
      d,
      {
        action: 'term',
        memberId: term.memberId,
        offerId: term.offerId,
        startsOn: addDays(term.endsOn, 1),
      },
      'renewal',
    );
    expect(next.terms[0].startsOn).toBe(addDays(term.endsOn, 1));
    expect(currentTerm(next, term.memberId, studioToday())?.id).toBe(term.id);
    const updated = applyDemoOperation(
      next,
      { action: 'offer', ...next.offers[0], pricePaise: 99999 },
      'offer',
    );
    expect(updated.terms[0].feePaise).toBe(next.terms[0].feePaise);
  });
  it('rejects hidden plans and paused members', () => {
    const d = demoOperations();
    expect(() =>
      validateTerm(d, d.members[10].id, d.offers[0].id, addDays(studioToday(), 100)),
    ).toThrow('active member');
    expect(() =>
      validateTerm(
        { ...d, offers: d.offers.map((p) => ({ ...p, active: false })) },
        d.members[0].id,
        d.offers[0].id,
        addDays(studioToday(), 100),
      ),
    ).toThrow('available plan');
  });
  it('accounts for partial payments, deduplicates retries and rejects overpayment', () => {
    const d = demoOperations(),
      term = d.terms[9];
    const payment = {
      action: 'payment' as const,
      id: crypto.randomUUID(),
      termId: term.id,
      amountPaise: 10000,
      paidOn: studioToday(),
      method: 'UPI' as const,
      reference: 'test',
    };
    const next = applyDemoOperation(d, payment, 'unused');
    expect(outstanding(term, next.payments)).toBe(term.feePaise - 10000);
    expect(applyDemoOperation(next, payment, 'unused').payments).toHaveLength(next.payments.length);
    expect(() =>
      applyDemoOperation(
        next,
        { ...payment, id: crypto.randomUUID(), amountPaise: term.feePaise },
        'unused',
      ),
    ).toThrow('exceeds');
    expect(() =>
      applyDemoOperation(
        next,
        { ...payment, id: crypto.randomUUID(), paidOn: addDays(studioToday(), 1) },
        'unused',
      ),
    ).toThrow('future');
    expect(() => applyDemoOperation(next, { action: 'cancelTerm', id: term.id }, 'unused')).toThrow(
      'paid term',
    );
  });
  it('keeps attendance separate from activity and blocks invalid access', () => {
    const d = demoOperations(),
      today = studioToday();
    const c = { action: 'attendance' as const, memberId: d.members[3].id, date: today };
    const next = applyDemoOperation(d, c, 'visit');
    expect(
      next.attendance.filter((a) => a.memberId === c.memberId && a.date === today),
    ).toHaveLength(1);
    expect(applyDemoOperation(next, c, 'visit-2').attendance).toHaveLength(next.attendance.length);
    expect(() => applyDemoOperation(d, { ...c, memberId: d.members[10].id }, 'bad')).toThrow(
      'active membership',
    );
    expect(() => applyDemoOperation(d, { ...c, date: addDays(today, 1) }, 'bad')).toThrow('future');
    // Visits older than the register's read window would save but never show.
    expect(() =>
      applyDemoOperation(d, { ...c, date: addDays(today, -ATTENDANCE_DAYS - 1) }, 'bad'),
    ).toThrow(`last ${ATTENDANCE_DAYS} days`);
  });
  it('rejects invalid calendar dates, fractional fees, and invalid payment methods', () => {
    const c = {
      action: 'payment',
      id: crypto.randomUUID(),
      termId: 't',
      amountPaise: 100,
      paidOn: '2026-02-30',
      method: 'UPI',
      reference: '',
    };
    expect(operationsSchema.safeParse(c).success).toBe(false);
    expect(
      operationsSchema.safeParse({ ...c, paidOn: '2026-10-19', amountPaise: 1.5 }).success,
    ).toBe(false);
    expect(
      operationsSchema.safeParse({ ...c, paidOn: '2026-10-19', method: 'crypto' }).success,
    ).toBe(false);
  });
});

describe('sample member access commands', () => {
  it('maps each access operation to the status its notice describes', () => {
    const base = demoOperations();
    const memberId = base.members[0].id;
    const run = (operation: 'resend' | 'sendEmail' | 'restore' | 'withdraw') =>
      applyDemoOperation(base, { action: 'memberAccess', memberId, operation } as never, 'x')
        .members[0].accessStatus;
    expect(run('sendEmail')).toBe('pending');
    expect(run('resend')).toBe('pending');
    expect(run('restore')).toBe('pending_restore');
    expect(run('withdraw')).toBe('withdrawn');
  });
  it('seeds sample coaches so the team workload is not empty', () => {
    expect(demoOperations().coaches?.length).toBeGreaterThan(0);
  });
});

describe('weekly studio class series', () => {
  const base = {
    action: 'studioClass' as const,
    title: 'Morning strength',
    trainer: 'Asha',
    location: 'Main studio',
    startsAt: '2030-01-07T03:30:00.000Z',
    duration: 45,
    capacity: 12,
    status: 'scheduled' as const,
  };
  it('keeps the same India start time each week and bounds the series', () => {
    const dates = weeklyOccurrences(base.startsAt, 4);
    expect(dates).toEqual([
      '2030-01-07T03:30:00.000Z',
      '2030-01-14T03:30:00.000Z',
      '2030-01-21T03:30:00.000Z',
      '2030-01-28T03:30:00.000Z',
    ]);
    expect(weeklyOccurrences(base.startsAt)).toHaveLength(1);
    expect(weeklyOccurrences(base.startsAt, 99)).toHaveLength(MAX_REPEAT_WEEKS);
    expect(operationsSchema.safeParse({ ...base, repeatWeeks: 13 }).success).toBe(false);
    expect(operationsSchema.safeParse({ ...base, repeatWeeks: 0 }).success).toBe(false);
  });
  it('creates separate editable classes in the demo studio', () => {
    const d = demoOperations();
    const next = applyDemoOperation(d, { ...base, repeatWeeks: 3 }, 'series');
    const created = next.studioClasses.filter((s) => s.title === 'Morning strength');
    expect(created.map((s) => s.id).sort()).toEqual(['series', 'series-w2', 'series-w3']);
    expect(new Set(created.map((s) => s.startsAt)).size).toBe(3);
    expect(created.every((s) => s.bookings.length === 0)).toBe(true);
    expect(next.studioClasses).toHaveLength(d.studioClasses.length + 3);
  });
  it('rejects repeating an existing class', () => {
    const d = applyDemoOperation(demoOperations(), base, 'one');
    expect(() => applyDemoOperation(d, { ...base, id: 'one', repeatWeeks: 4 }, 'x')).toThrow(
      'Only a new scheduled class can repeat weekly.',
    );
  });
});
