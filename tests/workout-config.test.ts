import { describe, expect, it } from 'vitest';
import { exerciseIds } from '../src/lib/exercise-profiles';
import { defaultWorkoutConfig, normalizeWorkoutConfig } from '../src/lib/workout-config';

describe('saved workout endpoint validation', () => {
  it.each(exerciseIds)('keeps fallback endpoints ordered for %s', (exercise) => {
    for (const bottomAngle of [undefined, NaN, Infinity]) {
      const config = normalizeWorkoutConfig(exercise, { topAngle: 0, bottomAngle });
      expect(config.topAngle - config.bottomAngle).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('plan block limb mode', () => {
  const block = { exercise: 'highknees', sets: 3, reps: 20, rest: 60 } as const;

  it('replaces a block mode the exercise does not support with its only mode', () => {
    expect(defaultWorkoutConfig('highknees', { ...block, armMode: 'left' }).armMode).toBe(
      'alternating',
    );
  });

  it('keeps a block mode the exercise supports', () => {
    expect(
      defaultWorkoutConfig('hammercurl', { ...block, exercise: 'hammercurl', armMode: 'left' })
        .armMode,
    ).toBe('left');
  });
});
