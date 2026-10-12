import { describe, expect, it } from 'vitest';
import { exerciseIds } from '../src/lib/exercise-profiles';
import { normalizeWorkoutConfig } from '../src/lib/workout-config';

describe('saved workout endpoint validation', () => {
  it.each(exerciseIds)('keeps fallback endpoints ordered for %s', (exercise) => {
    for (const bottomAngle of [undefined, NaN, Infinity]) {
      const config = normalizeWorkoutConfig(exercise, { topAngle: 0, bottomAngle });
      expect(config.topAngle - config.bottomAngle).toBeGreaterThanOrEqual(25);
    }
  });
});
