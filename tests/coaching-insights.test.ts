import { describe, it, expect } from 'vitest';
import { demoData } from '../src/lib/demo';
import { coachingOverview, traineeInsight } from '../src/lib/coaching-insights';
import { sessionEditVersion } from '../src/lib/session-management';
import type { CheckInView, WorkoutSetView } from '../src/lib/types';

const now = Date.parse('2026-10-11T06:00:00.000Z');
const checkIn = (userId: string, ageHours: number, energy = 1, soreness = 5): CheckInView => ({
  id: `${userId}-${ageHours}`,
  userId,
  userName: userId,
  energy,
  soreness,
  effort: null,
  sleepHours: null,
  bodyweightKg: null,
  note: '',
  createdAt: new Date(now - ageHours * 3600000).toISOString(),
});
const workout = (userId: string, endedAt: string): WorkoutSetView => ({
  id: userId + endedAt,
  clientId: userId + endedAt,
  userId,
  userName: userId,
  classId: null,
  classTitle: null,
  revision: 0,
  exercise: 'squat',
  ruleVersion: 'v3',
  setNumber: 1,
  target: 10,
  reps: 10,
  holdMs: 0,
  activeMs: 60000,
  trackedMs: 50000,
  formScore: 80,
  qualityScore: 90,
  rangeDegrees: 100,
  repSeconds: 2,
  confidence: 0.8,
  rejectedReps: 0,
  loadKg: null,
  completed: true,
  startedAt: endedAt,
  endedAt,
});
describe('coaching decisions', () => {
  it('prioritizes fresh trainee reports and does not treat old reports as current', () => {
    const data = demoData();
    data.checkIns = [checkIn('ava', 30), checkIn('leo', 1)];
    const result = coachingOverview(data, 'UTC', now);
    expect(result.followUps[0].person.id).toBe('leo');
    expect(result.followUps[0].reasons).toContain('High soreness reported');
    expect(result.trainees.find((item) => item.person.id === 'ava')?.reasons).not.toContain(
      'Low energy reported',
    );
    expect(result.cards[2].value).toBe(1);
  });
  it('uses each trainee’s latest check-in even when the global recent list is full', () => {
    const data = demoData(),
      person = { ...data.clients[0], latestCheckIn: checkIn('ava', 2) };
    data.checkIns = Array.from({ length: 100 }, (_, i) => checkIn('leo', i / 100));
    expect(traineeInsight(data, person, now).reasons).toContain('Low energy reported');
  });
  it('distinguishes a new member from a member without saved activity for a week', () => {
    const data = demoData();
    const old = { ...data.clients[0], joinedAt: new Date(now - 8 * 86400000).toISOString() };
    const fresh = { ...old, joinedAt: new Date(now - 86400000).toISOString() };
    expect(traineeInsight(data, old, now).reasons).toContain('No saved activity in 7 days');
    expect(traineeInsight(data, fresh, now).reasons).not.toContain('No saved activity in 7 days');
    expect(
      traineeInsight(data, { ...old, lastTrainingAt: new Date(now - 1000).toISOString() }, now)
        .reasons,
    ).not.toContain('No saved activity in 7 days');
  });
  it('counts a trainee’s own week and respects local calendar days', () => {
    const data = demoData();
    data.user = { ...data.clients[0] };
    data.workoutSets = [
      workout('ava', '2026-10-10T18:00:00.000Z'),
      workout('ava', '2026-10-10T19:00:00.000Z'),
      workout('leo', '2026-10-11T00:00:00.000Z'),
      workout('ava', '2026-10-01T00:00:00.000Z'),
    ];
    const result = coachingOverview(data, 'Asia/Kolkata', now);
    expect(result.own.trainingDays).toBe(2);
    expect(result.own.completedSets).toBe(2);
    expect(result.own.activeMs).toBe(120000);
  });
  it('does not invent a health alert from a missing check-in or future timestamp', () => {
    const data = demoData();
    data.checkIns = [checkIn('ava', -1)];
    expect(traineeInsight(data, data.clients[0], now).recentCheckIn).toBeNull();
    expect(traineeInsight(data, data.clients[1], now).reasons).not.toContain('Low energy reported');
  });
});
describe('session edit conflicts', () => {
  const session = {
    id: 'session',
    title: 'Training',
    startsAt: '2026-10-12T10:00:00.000Z',
    duration: 45,
    capacity: 30,
    status: 'scheduled',
    revision: 0,
    planId: null,
    enrollments: [{ userId: 'ava' }, { userId: 'leo' }],
  };
  it('accepts the same roster in a different order', () => {
    expect(sessionEditVersion(session)).toBe(
      sessionEditVersion({ ...session, enrollments: [...session.enrollments].reverse() }),
    );
  });
  it('invalidates an open editor after roster, time, plan, or session state changes', () => {
    for (const update of [
      { enrollments: [{ userId: 'ava' }] },
      { startsAt: '2026-10-12T11:00:00.000Z' },
      { planId: 'new-plan' },
      { revision: 1 },
      { status: 'live' },
      { capacity: 40 },
    ]) {
      expect(sessionEditVersion({ ...session, ...update })).not.toBe(sessionEditVersion(session));
    }
  });
});
