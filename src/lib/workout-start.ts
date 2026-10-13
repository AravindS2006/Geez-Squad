import type { Analysis } from './pose-engine';
import type { ExerciseId } from './types';
import type { WorkoutConfig } from './workout-config';
import { getExerciseProfile } from './exercise-profiles';

export type StartCountdown = {
  remainingMs: number;
  lastFrameAt: number | null;
  invalidSince: number | null;
  acquired: boolean;
};
export const START_DELAY_MS = 5000;
export const MAX_START_FRAME_GAP_MS = 750;
export const START_POSE_GRACE_MS = 1200;

export function initialStartCountdown(): StartCountdown {
  return { remainingMs: START_DELAY_MS, lastFrameAt: null, invalidSince: null, acquired: false };
}

// Count only fresh eligible intervals. A brief uncertain observation pauses the
// clock, while sustained lost positioning or stale frames require a new start.
export function advanceStartCountdown(
  state: StartCountdown,
  ready: boolean,
  timestamp: number,
): StartCountdown {
  if (!Number.isFinite(timestamp) || timestamp < 0) return initialStartCountdown();
  if (!state.acquired || state.lastFrameAt === null)
    return ready
      ? { ...initialStartCountdown(), acquired: true, lastFrameAt: timestamp }
      : initialStartCountdown();
  const gap = timestamp - state.lastFrameAt;
  if (!Number.isFinite(gap) || gap <= 0 || gap > MAX_START_FRAME_GAP_MS)
    return initialStartCountdown();
  if (state.invalidSince !== null && timestamp - state.invalidSince >= START_POSE_GRACE_MS)
    return initialStartCountdown();
  if (!ready)
    return { ...state, lastFrameAt: timestamp, invalidSince: state.invalidSince ?? timestamp };
  return {
    ...state,
    remainingMs:
      state.invalidSince === null ? Math.max(0, state.remainingMs - gap) : state.remainingMs,
    lastFrameAt: timestamp,
    invalidSince: null,
  };
}

export function canStartWorkout(
  result: Analysis,
  exercise: ExerciseId,
  config: WorkoutConfig,
  continuing = false,
): boolean {
  const profile = getExerciseProfile(exercise);
  if (
    !result.tracked ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0.65 ||
    result.confidence > 1 ||
    result.postureValid === false ||
    (result.score === null
      ? result.postureValid !== true
      : !Number.isFinite(result.score) ||
        result.score < 0 ||
        (result.postureValid !== true && result.score < (continuing ? 65 : 75)) ||
        result.score > 100) ||
    result.angle === null ||
    !Number.isFinite(result.angle) ||
    result.angle < 0 ||
    result.angle > 180 ||
    !Number.isFinite(config.topAngle) ||
    !Number.isFinite(config.bottomAngle)
  )
    return false;
  if (profile.isHold) return result.phase === 'holding' && result.angle >= config.topAngle;
  const atStart =
    profile.direction === 'decrease'
      ? result.angle >= config.topAngle - (continuing ? 8 : 0)
      : result.angle <= config.bottomAngle + (continuing ? 8 : 0);
  if (continuing) return atStart;
  return atStart && result.phase === (exercise === 'curl' ? 'arm extended' : 'start position');
}
