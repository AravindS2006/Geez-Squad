import type { Block, ExerciseId } from './types';
import { getExerciseProfile } from './exercise-profiles';
import { exerciseDefinition, isAutomaticExercise, type ArmMode } from './exercise-library';

export type WorkoutConfig = {
  sets: number;
  target: number;
  rest: number;
  side: 'auto' | 'left' | 'right';
  calibrationSource?: '2d' | '3d';
  topAngle: number;
  bottomAngle: number;
  minRepMs: number;
  loadKg: number | null;
  loadBasis?: 'per-hand' | 'total';
  armMode?: ArmMode;
};

export function defaultWorkoutConfig(exercise: ExerciseId, block?: Block): WorkoutConfig {
  const profile = isAutomaticExercise(exercise) ? getExerciseProfile(exercise) : null;
  return {
    sets: block?.sets ?? 3,
    target:
      block?.reps ??
      (exerciseDefinition(exercise).targetUnit === 'seconds'
        ? 30
        : exercise === 'pushup'
          ? 10
          : 12),
    rest: block?.rest ?? 60,
    side: 'auto',
    topAngle: profile?.topAngle ?? 155,
    bottomAngle: profile?.bottomAngle ?? 90,
    minRepMs: profile?.minRepMs ?? 500,
    loadKg: block?.loadKg ?? null,
    ...(block?.armMode ? { armMode: block.armMode } : {}),
    ...(block?.loadBasis ? { loadBasis: block.loadBasis } : {}),
  };
}

// Saved browser preferences and form fields are untrusted, including non-finite numbers.
export function normalizeWorkoutConfig(
  exercise: ExerciseId,
  input: Partial<WorkoutConfig>,
): WorkoutConfig {
  input = input && typeof input === 'object' ? input : {};
  const defaults = defaultWorkoutConfig(exercise);
  const profile = isAutomaticExercise(exercise) ? getExerciseProfile(exercise) : null;
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
    profile?.signal === 'shoulder' ? 50 : 110,
    175,
  );
  const minimumGap = 25;
  return {
    sets: bounded(input.sets, defaults.sets, 1, 10),
    target: bounded(input.target, defaults.target, 1, 120),
    rest: bounded(input.rest, defaults.rest, 0, 300),
    side: input.side === 'left' || input.side === 'right' ? input.side : 'auto',
    ...(exerciseDefinition(exercise).modes.includes(input.armMode as ArmMode)
      ? { armMode: input.armMode }
      : {}),
    ...(input.loadBasis === 'per-hand' || input.loadBasis === 'total'
      ? { loadBasis: input.loadBasis }
      : {}),
    ...((input.side === 'left' || input.side === 'right') &&
    (input.calibrationSource === '2d' || input.calibrationSource === '3d')
      ? { calibrationSource: input.calibrationSource }
      : {}),
    topAngle,
    bottomAngle: bounded(
      input.bottomAngle,
      defaults.bottomAngle,
      profile?.signal === 'shoulder' ? 5 : 35,
      topAngle - minimumGap,
    ),
    minRepMs: bounded(input.minRepMs, defaults.minRepMs, 350, 3000),
    loadKg:
      typeof input.loadKg === 'number' && Number.isFinite(input.loadKg)
        ? Math.max(0, Math.min(500, input.loadKg))
        : defaults.loadKg,
  };
}
