import { describe, it, expect } from 'vitest';
import {
  addDays,
  applyDemoOperation,
  currentTerm,
  demoOperations,
  operationsSchema,
  outstanding,
  studioToday,
  termStatus,
  validateTerm,
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
