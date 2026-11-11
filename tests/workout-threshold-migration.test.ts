import { describe, expect, it } from 'vitest';
import {
  defaultWorkoutConfig,
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
  it('never resets a range saved under the current generation, so the reset happens once', () => {
    const tuned = normalizeWorkoutConfig('pushup', { topAngle: 130 });
    const stamped = stampWorkoutConfig(tuned);
    expect(stamped.thresholdGeneration).toBe(THRESHOLD_GENERATION);
    const again = migrateSavedThresholds('pushup', JSON.parse(JSON.stringify(stamped)));
    expect(again.reset).toBe(false);
    expect(again.config.topAngle).toBe(130);
    expect(again.config).not.toHaveProperty('thresholdGeneration');
  });
});
