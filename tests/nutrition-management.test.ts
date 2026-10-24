import { expect, it } from 'vitest';
import {
  nutritionEntrySchema,
  nutritionProfileSchema,
  nutritionTotals,
} from '../src/lib/nutrition';
import {
  classOverlap,
  demoOperations,
  managementInsights,
  studioToday,
  applyDemoOperation,
  operationsSchema,
} from '../src/lib/studio-operations';
const entry = {
  id: 'cfe62075-7d2f-4c59-b010-d83f8b9ed523',
  date: '2026-10-24',
  meal: 'Breakfast' as const,
  description: 'Oats',
  calories: null,
  protein: null,
  carbs: null,
  fat: null,
  waterMl: 250,
};
it('distinguishes unknown nutrition from an explicitly entered zero', () => {
  const sum = nutritionTotals([entry, { ...entry, calories: 0, protein: 12.5 }]);
  expect(sum.calories).toEqual({ value: 0, known: 1, total: 2 });
  expect(sum.protein.value).toBe(12.5);
  expect(sum.waterMl).toBe(500);
});
it('rejects invalid dates and non-finite or negative nutrition measurements', () => {
  for (const invalid of [
    { date: '2026-02-30' },
    { protein: NaN },
    { calories: -1 },
    { waterMl: 0.5 },
  ])
    expect(nutritionEntrySchema.safeParse({ ...entry, ...invalid }).success).toBe(false);
  expect(nutritionEntrySchema.safeParse(entry).success).toBe(true);
  expect(
    nutritionProfileSchema.parse({
      calories: null,
      protein: null,
      waterMl: null,
      preferences: '',
      guidance: '',
      shareWithCoach: true,
    }),
  ).not.toHaveProperty('shareWithCoach');
});
it('allows back-to-back classes but detects partial and contained overlaps', () => {
  const a = { startsAt: '2026-10-25T10:00:00Z', duration: 60 };
  expect(classOverlap(a, { startsAt: '2026-10-25T11:00:00Z', duration: 60 })).toBe(false);
  expect(classOverlap(a, { startsAt: '2026-10-25T10:30:00Z', duration: 15 })).toBe(true);
  expect(classOverlap(a, { startsAt: '2026-10-25T09:59:00Z', duration: 2 })).toBe(true);
});
it('identifies renewal and attendance follow-ups using membership eligibility', () => {
  const data = demoOperations(),
    today = studioToday();
  const insights = managementInsights(data, today);
  expect(insights.expiring.map((m) => m.id)).toContain('member-0');
  expect(insights.quiet.map((m) => m.id)).not.toContain('member-10');
  expect(insights.quiet.map((m) => m.id)).not.toContain('member-0');
  const removed = applyDemoOperation(
    data,
    { action: 'removeAttendance', memberId: 'member-0', date: today, reason: 'Incorrect check-in' },
    'correction',
  );
  expect(removed.attendance).toHaveLength(data.attendance.length - 1);
  expect(removed.attendance.some((a) => a.memberId === 'member-1' && a.date === today)).toBe(true);
  expect(
    operationsSchema.safeParse({
      action: 'removeAttendance',
      memberId: 'member-0',
      date: today,
      reason: '',
    }).success,
  ).toBe(false);
});
