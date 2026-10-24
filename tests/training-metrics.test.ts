import { describe, it, expect } from 'vitest';
import {
  initialTrainingMetrics,
  observeTrainingMetrics,
  pauseTrainingMetrics,
  trainingMetricsSummary,
} from '../src/lib/training-metrics';
import { summarizeWorkouts, workoutCsv, csvCell } from '../src/lib/progress-metrics';
import { workoutSetSchema } from '../src/lib/validation';
import type { Analysis } from '../src/lib/pose-engine';
import type { WorkoutSetView } from '../src/lib/types';
const pose: Analysis = {
  reps: 0,
  holdSeconds: 0,
  tracked: true,
  score: 80,
  confidence: 0.9,
  phase: 'start',
  cue: 'Ready',
  angle: 170,
  ruleVersion: 'profile-v3',
};
export const set: WorkoutSetView = {
  id: 'one',
  userId: 'trainee',
  userName: 'Trainee',
  classTitle: null,
  clientId: '010b4820-902c-4990-972b-7d38bba59310',
  classId: null,
  revision: 0,
  exercise: 'curl',
  ruleVersion: 'profile-v3',
  setNumber: 1,
  target: 2,
  reps: 2,
  holdMs: 0,
  activeMs: 10000,
  trackedMs: 8000,
  formScore: 80,
  qualityScore: 90,
  rangeDegrees: 100,
  repSeconds: 2,
  confidence: 0.9,
  rejectedReps: 1,
  loadKg: 5,
  loadBasis: 'total',
  completed: true,
  startedAt: '2026-10-09T00:00:00.000Z',
  endedAt: '2026-10-09T00:00:10.000Z',
};
describe('observed training metrics', () => {
  it('weights form by reliable time and does not bridge tracking loss', () => {
    const state = initialTrainingMetrics(0, 0);
    observeTrainingMetrics(state, pose, 100);
    observeTrainingMetrics(state, { ...pose, tracked: false, score: null, confidence: 0 }, 200);
    observeTrainingMetrics(state, { ...pose, score: 100 }, 300);
    observeTrainingMetrics(state, { ...pose, score: 100 }, 500);
    expect(trainingMetricsSummary(state)).toMatchObject({
      activeMs: 500,
      trackedMs: 300,
      formScore: 93.3,
      trackingCoverage: 60,
    });
  });
  it('excludes pauses, missing frame intervals, and out-of-order frames', () => {
    const state = initialTrainingMetrics(0, 0);
    observeTrainingMetrics(state, pose, 100);
    observeTrainingMetrics(state, pose, 90);
    observeTrainingMetrics(state, pose, 200);
    observeTrainingMetrics(state, pose, 4000);
    pauseTrainingMetrics(state);
    observeTrainingMetrics(state, pose, 6000);
    observeTrainingMetrics(state, pose, 6100);
    expect(trainingMetricsSummary(state)).toMatchObject({ activeMs: 300, trackedMs: 300 });
  });
  it('scores completed reps once and counts each rejected cycle once', () => {
    const state = initialTrainingMetrics();
    const completed = {
      ...pose,
      reps: 1,
      lastRepQuality: 88,
      rangeDegrees: 92,
      lastRepSeconds: 1.4,
    };
    observeTrainingMetrics(state, completed, 100);
    observeTrainingMetrics(state, completed, 200);
    const rejected = { ...completed, rejectionReason: 'Incomplete range' };
    observeTrainingMetrics(state, rejected, 300, 1000);
    observeTrainingMetrics(state, rejected, 400, 1000);
    observeTrainingMetrics(
      state,
      { ...completed, reps: 2, lastRepQuality: 96, rangeDegrees: 100, lastRepSeconds: 1.8 },
      500,
    );
    expect(trainingMetricsSummary(state)).toMatchObject({
      qualityScore: 92,
      rangeDegrees: 96,
      repSeconds: 1.6,
      rejectedReps: 1,
    });
  });
  it('keeps unavailable quality unavailable', () =>
    expect(trainingMetricsSummary(initialTrainingMetrics())).toMatchObject({
      formScore: null,
      qualityScore: null,
      trackingCoverage: null,
      confidence: null,
    }));
});
describe('durable progress calculations', () => {
  it('weights quality by counted reps and form by tracked time', () => {
    const totals = summarizeWorkouts([
      set,
      {
        ...set,
        id: 'two',
        reps: 6,
        qualityScore: 70,
        trackedMs: 2000,
        formScore: 100,
        loadKg: null,
        completed: false,
      },
    ]);
    expect(totals).toMatchObject({
      reps: 8,
      sets: 2,
      completedSets: 1,
      quality: 75,
      form: 84,
      coverage: 50,
      loadVolume: 10,
      loadedSets: 1,
      trainingDays: 1,
    });
  });
  it('includes holds without inventing rep metrics', () => {
    const totals = summarizeWorkouts([
      { ...set, exercise: 'plank', reps: 0, holdMs: 6000, qualityScore: null, loadKg: null },
    ]);
    expect(totals).toMatchObject({
      reps: 0,
      holdMs: 6000,
      quality: null,
      range: null,
      tempo: null,
      loadVolume: 0,
    });
  });
  it('uses the selected time zone for training days', () => {
    const records = [
      { ...set, endedAt: '2026-10-08T23:55:00Z' },
      { ...set, id: 'two', endedAt: '2026-10-09T00:05:00Z' },
    ];
    expect(summarizeWorkouts(records, 'UTC').trainingDays).toBe(2);
    expect(summarizeWorkouts(records, 'Asia/Kolkata').trainingDays).toBe(1);
  });
  it('exports escaped CSV and protects formula fields', () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(workoutCsv([{ ...set, userName: '=bad', classTitle: 'Class, "A"' }])).toContain(
      '"\'=bad","curl","Class, ""A"""',
    );
    expect(workoutCsv([set]).split('\r\n')).toHaveLength(2);
  });
  it.each([
    { trackedMs: 20000 },
    { activeMs: 100000 },
    { holdMs: 9000 },
    { reps: 500 },
    { startedAt: set.endedAt, endedAt: set.startedAt },
  ])('rejects inconsistent timing/counts: %j', (values) => {
    const { id: _, userId: _u, userName: _n, classTitle: _c, ...record } = set;
    expect(workoutSetSchema.safeParse({ ...record, ...values }).success).toBe(false);
  });
});
