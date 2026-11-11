import { describe, expect, it } from 'vitest';
import {
  defaultWorkoutConfig,
  DEFAULTS_GENERATION,
  migrateSavedThresholds,
  normalizeWorkoutConfig,
  stampWorkoutConfig,
  THRESHOLD_GENERATION,
} from '../src/lib/workout-config';

describe('saved threshold migration', () => {
  it('resets hand-tuned thresholds on a planar profile saved before on-screen geometry', () => {
    const result = migrateSavedThresholds('pushup', { topAngle: 130, bottomAngle: 95, sets: 4 });
    expect(result.reset).toBe(true);
    expect(result.config).toEqual({ sets: 4 });
    const defaults = defaultWorkoutConfig('pushup');
    expect(normalizeWorkoutConfig('pushup', result.config)).toMatchObject({
      topAngle: defaults.topAngle,
      bottomAngle: defaults.bottomAngle,
      sets: 4,
    });
  });
  it('keeps untouched defaults, calibrated ranges and depth-measured profiles', () => {
    const defaults = defaultWorkoutConfig('pushup');
    expect(migrateSavedThresholds('pushup', defaults).reset).toBe(false);
    const calibrated = { side: 'left', calibrationSource: '3d', topAngle: 130 } as const;
    expect(migrateSavedThresholds('pushup', calibrated)).toEqual({
      config: calibrated,
      reset: false,
    });
    expect(migrateSavedThresholds('curl', { topAngle: 130 }).reset).toBe(false);
    expect(migrateSavedThresholds('pushup', null)).toEqual({ config: {}, reset: false });
  });
  it('keeps a saved default curl range, so the Full and Lite model offsets still apply to it', () => {
    expect(THRESHOLD_GENERATION).toBe(9);
    const saved = { ...defaultWorkoutConfig('curl'), thresholdGeneration: 8 };
    const result = migrateSavedThresholds('curl', saved);
    expect(result.reset).toBe(false);
    expect(result.config).toMatchObject({ topAngle: 145, bottomAngle: 85 });
  });
  it('never resets a range saved under the current generation, so the reset happens once', () => {
    const tuned = normalizeWorkoutConfig('pushup', { topAngle: 130 });
    const stamped = stampWorkoutConfig(tuned);
    expect(stamped.thresholdGeneration).toBe(THRESHOLD_GENERATION);
    const again = migrateSavedThresholds('pushup', JSON.parse(JSON.stringify(stamped)));
    expect(again.reset).toBe(false);
    expect(again.config.topAngle).toBe(130);
    expect(again.config).not.toHaveProperty('thresholdGeneration');
  });
  // profile-v10 changed the press top (155 -> 140) and the raise start (20 -> 28).
  it.each([
    ['shoulderpress', 'topAngle', 155, 140],
    ['lateralraise', 'bottomAngle', 20, 28],
  ] as const)(
    'moves a %s %s saved at the old default %i to %i without a reset notice',
    (exercise, field, old, current) => {
      for (const thresholdGeneration of [9, undefined]) {
        const result = migrateSavedThresholds(exercise, {
          [field]: old,
          target: 12,
          thresholdGeneration,
        });
        expect(result.reset).toBe(false);
        expect(result.config).toEqual({ target: 12 });
        expect(normalizeWorkoutConfig(exercise, result.config)[field]).toBe(current);
      }
    },
  );
  it.each([
    ['shoulderpress', 'topAngle', 155, 150],
    ['lateralraise', 'bottomAngle', 20, 25],
  ] as const)('keeps a tuned or calibrated %s %s', (exercise, field, old, tuned) => {
    const handTuned = migrateSavedThresholds(exercise, { [field]: tuned, thresholdGeneration: 9 });
    expect(handTuned).toEqual({ config: { [field]: tuned }, reset: false });
    const calibrated = { side: 'left', calibrationSource: '2d', [field]: old } as const;
    expect(
      migrateSavedThresholds(exercise, { ...calibrated, thresholdGeneration: 9 }).config,
    ).toEqual(calibrated);
    // A config saved after profile-v10 that holds the old value was chosen on purpose.
    const chosen = stampWorkoutConfig(normalizeWorkoutConfig(exercise, { [field]: old }));
    expect(chosen.defaultsGeneration).toBe(DEFAULTS_GENERATION);
    expect(migrateSavedThresholds(exercise, chosen).config[field]).toBe(old);
  });
});
