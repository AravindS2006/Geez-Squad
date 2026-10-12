import { describe, expect, it } from 'vitest';
import { metricElapsedSeconds } from '../src/lib/metric-policy';
import { metricSchema } from '../src/lib/validation';

describe('summary delivery timing', () => {
  it('allows a delayed first packet to catch up using the consented class timeline', () => {
    expect(metricElapsedSeconds(60000, new Date(0), new Date(10000))).toBe(50);
  });
  it('does not count time before either the class start or consent', () => {
    expect(metricElapsedSeconds(60000, new Date(20000), new Date(10000))).toBe(40);
    expect(metricElapsedSeconds(5000, null, new Date(10000))).toBe(0);
  });
  it('bounds subsequent delivery against the last accepted packet', () => {
    expect(metricElapsedSeconds(60000, new Date(0), new Date(10000), new Date(57000))).toBe(3);
  });
  it('rejects incompatible progress units before they corrupt session totals', () => {
    const packet = {
      classId: 'class',
      exercise: 'squat',
      revision: 0,
      reps: 1,
      holdSeconds: 0,
      score: null,
      confidence: 0.9,
      phase: 'moving',
      cue: '',
    };
    expect(metricSchema.safeParse(packet).success).toBe(true);
    expect(metricSchema.safeParse({ ...packet, holdSeconds: 1 }).success).toBe(false);
    expect(metricSchema.safeParse({ ...packet, exercise: 'plank' }).success).toBe(false);
    expect(
      metricSchema.safeParse({ ...packet, exercise: 'plank', reps: 0, holdSeconds: 1 }).success,
    ).toBe(true);
  });
});
