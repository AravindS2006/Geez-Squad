import type { Block, ExerciseId } from './types';
import { getExerciseProfile } from './exercise-profiles';

export type WorkoutConfig = {
  sets: number;
  target: number;
  rest: number;
  side: 'auto' | 'left' | 'right';
  topAngle: number;
  bottomAngle: number;
  minRepMs: number;
  loadKg: number | null;
};

export function defaultWorkoutConfig(exercise: ExerciseId, block?: Block): WorkoutConfig {
  const profile = getExerciseProfile(exercise);
  return {
    sets: block?.sets ?? 3,
    target: block?.reps ?? (profile.isHold ? 30 : exercise === 'pushup' ? 10 : 12),
    rest: block?.rest ?? 60,
    side: 'auto',
    topAngle: profile.topAngle,
    bottomAngle: profile.bottomAngle,
    minRepMs: profile.minRepMs,
    loadKg: block?.loadKg ?? null,
  };
}

// Saved browser preferences and form fields are untrusted, including non-finite numbers.
export function normalizeWorkoutConfig(
  exercise: ExerciseId,
  input: Partial<WorkoutConfig>,
): WorkoutConfig {
  const defaults = defaultWorkoutConfig(exercise);
  const profile = getExerciseProfile(exercise);
  const bounded = (value: unknown, fallback: number, min: number, max: number) =>
    Math.round(
      Math.max(
        min,
        Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback),
      ),
    );
  const topAngle = bounded(
    input.topAngle,
    defaults.topAngle,
    profile.signal === 'shoulder' ? 50 : 110,
    175,
  );
  const minimumGap = 25;
  return {
    sets: bounded(input.sets, defaults.sets, 1, 10),
    target: bounded(input.target, defaults.target, 1, 120),
    rest: bounded(input.rest, defaults.rest, 0, 300),
    side: input.side === 'left' || input.side === 'right' ? input.side : 'auto',
    topAngle,
    bottomAngle: bounded(
      input.bottomAngle,
      defaults.bottomAngle,
      profile.signal === 'shoulder' ? 5 : 35,
      topAngle - minimumGap,
    ),
    minRepMs: bounded(input.minRepMs, defaults.minRepMs, 350, 3000),
    loadKg:
      typeof input.loadKg === 'number' && Number.isFinite(input.loadKg)
        ? Math.max(0, Math.min(500, input.loadKg))
        : defaults.loadKg,
  };
}
