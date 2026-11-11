import type { Block, ExerciseId } from './types';
import { getExerciseProfile, usesImageGeometry } from './exercise-profiles';
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

// An exercise with exactly one limb mode (alternating legs) always runs in that mode.
function onlyMode(exercise: ExerciseId): ArmMode | undefined {
  const modes = exerciseDefinition(exercise).modes;
  return modes.length === 1 ? modes[0] : undefined;
}

export function defaultWorkoutConfig(exercise: ExerciseId, block?: Block): WorkoutConfig {
  const profile = isAutomaticExercise(exercise) ? getExerciseProfile(exercise) : null;
  const armMode =
    block?.armMode && exerciseDefinition(exercise).modes.includes(block.armMode)
      ? block.armMode
      : onlyMode(exercise);
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
    ...(armMode ? { armMode } : {}),
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
      : onlyMode(exercise)
        ? { armMode: onlyMode(exercise) }
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

/**
 * Generation of the angles that saved top/bottom thresholds are compared with. From 9,
 * planar profiles measure on screen instead of with depth landmarks, which read full
 * extension 15-30 degrees short. Bump it whenever that meaning changes again.
 */
export const THRESHOLD_GENERATION = 9;
export type SavedWorkoutConfig = Partial<WorkoutConfig> & { thresholdGeneration?: number };
/** Stamp a config for storage so a later load knows which angles its thresholds mean. */
export function stampWorkoutConfig(
  config: WorkoutConfig,
): WorkoutConfig & { thresholdGeneration: number } {
  return { ...config, thresholdGeneration: THRESHOLD_GENERATION };
}
/**
 * Thresholds a trainee tuned by hand against depth angles would now be compared with
 * larger on-screen angles and count partial reps. Drop them back to the profile defaults.
 * Calibrated ranges carry their own measurement space and are kept, as are profiles that
 * still measure with depth.
 */
export function migrateSavedThresholds(
  exercise: ExerciseId,
  saved: SavedWorkoutConfig | null | undefined,
): { config: Partial<WorkoutConfig>; reset: boolean } {
  const { thresholdGeneration, ...config } = saved && typeof saved === 'object' ? saved : {};
  if (thresholdGeneration === THRESHOLD_GENERATION || !isAutomaticExercise(exercise))
    return { config, reset: false };
  const profile = getExerciseProfile(exercise);
  const calibrated =
    (config.side === 'left' || config.side === 'right') &&
    (config.calibrationSource === '2d' || config.calibrationSource === '3d');
  const tuned =
    (config.topAngle !== undefined && config.topAngle !== profile.topAngle) ||
    (config.bottomAngle !== undefined && config.bottomAngle !== profile.bottomAngle);
  if (!usesImageGeometry(profile) || calibrated || !tuned) return { config, reset: false };
  const { topAngle: _top, bottomAngle: _bottom, ...kept } = config;
  return { config: kept, reset: true };
}
