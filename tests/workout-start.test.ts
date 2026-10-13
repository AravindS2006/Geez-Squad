import { describe, expect, it } from 'vitest';
import type { Analysis } from '../src/lib/pose-engine';
import type { ExerciseId } from '../src/lib/types';
import { exerciseIds, getExerciseProfile, isHoldExercise } from '../src/lib/exercise-profiles';
import { defaultWorkoutConfig } from '../src/lib/workout-config';
import {
  advanceStartCountdown,
  canStartWorkout,
  initialStartCountdown,
  START_POSE_GRACE_MS,
} from '../src/lib/workout-start';

function readyPose(exercise: ExerciseId, change: Partial<Analysis> = {}): Analysis {
  return {
    reps: 0,
    holdSeconds: 0,
    score: 100,
    confidence: 0.95,
    phase: isHoldExercise(exercise)
      ? 'holding'
      : exercise === 'curl'
        ? 'arm extended'
        : 'start position',
    cue: 'Ready',
    angle: getExerciseProfile(exercise).direction === 'increase' ? 0 : 180,
    tracked: true,
    ruleVersion: 'profile-v3',
    ...change,
  };
}

describe('hands-free set start', () => {
  it('requires five seconds of fresh consecutive ready frames', () => {
    let state = initialStartCountdown();
    expect(state).toEqual({
      remainingMs: 5000,
      lastFrameAt: null,
      invalidSince: null,
      acquired: false,
    });
    state = advanceStartCountdown(state, true, 1000);
    expect(state.remainingMs).toBe(5000);
    for (let timestamp = 1100; timestamp < 6000; timestamp += 100)
      state = advanceStartCountdown(state, true, timestamp);
    expect(state.remainingMs).toBe(100);
    state = advanceStartCountdown(state, true, 6000);
    expect(state.remainingMs).toBe(0);
    expect(advanceStartCountdown(state, true, 6100).remainingMs).toBe(0);
  });

  it('pauses briefly lost positioning without crediting invalid or recovery intervals', () => {
    const first = advanceStartCountdown(initialStartCountdown(), true, 1000);
    const ticking = advanceStartCountdown(first, true, 1500);
    expect(ticking.remainingMs).toBe(4500);
    const paused = advanceStartCountdown(ticking, false, 1600);
    expect(paused.remainingMs).toBe(4500);
    expect(paused.invalidSince).toBe(1600);
    const uncertain = advanceStartCountdown(paused, false, 1900);
    expect(uncertain.remainingMs).toBe(4500);
    const recovered = advanceStartCountdown(uncertain, true, 2100);
    expect(recovered.remainingMs).toBe(4500);
    expect(recovered.invalidSince).toBeNull();
    expect(advanceStartCountdown(recovered, true, 2200).remainingMs).toBe(4400);
  });

  it('requires a new starting pose after sustained loss, including a valid recovery at the limit', () => {
    const first = advanceStartCountdown(initialStartCountdown(), true, 1000);
    const ticking = advanceStartCountdown(first, true, 1500);
    let paused = advanceStartCountdown(ticking, false, 1600);
    paused = advanceStartCountdown(paused, false, 2100);
    paused = advanceStartCountdown(paused, false, 2600);
    for (const ready of [true, false]) {
      const reset = advanceStartCountdown(paused, ready, 1600 + START_POSE_GRACE_MS);
      expect(reset).toEqual(initialStartCountdown());
      expect(advanceStartCountdown(reset, true, 2900).remainingMs).toBe(5000);
    }
  });

  it('never starts from uncertain observations or completes a paused final interval', () => {
    expect(advanceStartCountdown(initialStartCountdown(), false, 1000)).toEqual(
      initialStartCountdown(),
    );
    let state = advanceStartCountdown(initialStartCountdown(), true, 1000);
    for (let timestamp = 1100; timestamp <= 5900; timestamp += 100)
      state = advanceStartCountdown(state, true, timestamp);
    expect(state.remainingMs).toBe(100);
    state = advanceStartCountdown(state, false, 6000);
    state = advanceStartCountdown(state, true, 6500);
    expect(state.remainingMs).toBe(100);
    expect(advanceStartCountdown(state, true, 6600).remainingMs).toBe(0);
  });

  it('cannot build countdown time by alternating eligible and uncertain frames', () => {
    let state = advanceStartCountdown(initialStartCountdown(), true, 1000);
    for (let timestamp = 1100; timestamp < 4000; timestamp += 100)
      state = advanceStartCountdown(state, timestamp % 200 === 0, timestamp);
    expect(state.remainingMs).toBe(5000);
  });

  it('does not count a camera frame gap greater than 750 milliseconds', () => {
    const first = advanceStartCountdown(initialStartCountdown(), true, 1000);
    const boundary = advanceStartCountdown(first, true, 1750);
    expect(boundary.remainingMs).toBe(4250);
    const reset = advanceStartCountdown(boundary, true, 2501);
    expect(reset).toEqual(initialStartCountdown());
    expect(advanceStartCountdown(reset, true, 2601).remainingMs).toBe(5000);
  });

  it.each([1000, 900, NaN, Infinity, -Infinity])(
    'does not credit duplicate, backwards or invalid timestamps (%s)',
    (timestamp) => {
      const first = advanceStartCountdown(initialStartCountdown(), true, 1000);
      const result = advanceStartCountdown(first, true, timestamp);
      expect(result.remainingMs).toBe(5000);
      expect(Number.isFinite(result.remainingMs)).toBe(true);
    },
  );

  it.each(exerciseIds)('accepts the visible aligned starting position for %s', (exercise) => {
    const config = defaultWorkoutConfig(exercise);
    expect(canStartWorkout(readyPose(exercise), exercise, config)).toBe(true);
    expect(
      canStartWorkout(
        readyPose(exercise, {
          confidence: 0.65,
          score: 75,
          angle: isHoldExercise(exercise)
            ? config.topAngle
            : getExerciseProfile(exercise).direction === 'increase'
              ? config.bottomAngle
              : config.topAngle,
        }),
        exercise,
        config,
      ),
    ).toBe(true);
  });

  it.each([
    { tracked: false },
    { confidence: 0.64 },
    { confidence: NaN },
    { confidence: Infinity },
    { score: null },
    { score: 74 },
    { score: NaN },
    { score: Infinity },
    { angle: null },
    { angle: 95 },
    { angle: NaN },
    { angle: Infinity },
    { phase: 'lowered' },
    { phase: 'find start position' },
  ] satisfies Partial<Analysis>[])('rejects missing or invalid readiness data %j', (change) => {
    expect(
      canStartWorkout(readyPose('squat', change), 'squat', defaultWorkoutConfig('squat')),
    ).toBe(false);
  });

  it('respects the configured top angle instead of accepting any detected pose', () => {
    const config = { ...defaultWorkoutConfig('squat'), topAngle: 165 };
    expect(canStartWorkout(readyPose('squat', { angle: 160 }), 'squat', config)).toBe(false);
    expect(canStartWorkout(readyPose('squat', { angle: 165 }), 'squat', config)).toBe(true);
  });

  it('requires an aligned holding plank rather than an adjusting plank', () => {
    const config = defaultWorkoutConfig('plank');
    expect(canStartWorkout(readyPose('plank', { angle: 154 }), 'plank', config)).toBe(false);
    expect(canStartWorkout(readyPose('plank', { phase: 'adjusting' }), 'plank', config)).toBe(
      false,
    );
  });

  it('requires the exercise-specific ready phase', () => {
    const config = defaultWorkoutConfig('curl');
    expect(canStartWorkout(readyPose('curl', { phase: 'start position' }), 'curl', config)).toBe(
      false,
    );
  });

  it.each(['shoulderpress', 'lateralraise', 'jumpingjack', 'glutebridge'] as const)(
    'acquires the lower starting endpoint for %s and tolerates jitter only after acquisition',
    (exercise) => {
      const config = defaultWorkoutConfig(exercise);
      const high = readyPose(exercise, { angle: config.topAngle });
      expect(canStartWorkout(high, exercise, config)).toBe(false);
      const jitter = readyPose(exercise, {
        angle: config.bottomAngle + 8,
        score: 65,
        phase: 'moving',
      });
      expect(canStartWorkout(jitter, exercise, config)).toBe(false);
      expect(canStartWorkout(jitter, exercise, config, true)).toBe(true);
      expect(
        canStartWorkout({ ...jitter, angle: config.bottomAngle + 9 }, exercise, config, true),
      ).toBe(false);
      expect(canStartWorkout(readyPose(exercise), exercise, { ...config, bottomAngle: NaN })).toBe(
        false,
      );
    },
  );

  it.each(['squat', 'pushup', 'curl'] as const)(
    'allows small angle and score jitter only after acquiring %s',
    (exercise) => {
      const config = defaultWorkoutConfig(exercise);
      const jitter = readyPose(exercise, {
        angle: config.topAngle - 8,
        phase: 'moving',
        score: 65,
      });
      expect(canStartWorkout(jitter, exercise, config)).toBe(false);
      expect(canStartWorkout(jitter, exercise, config, true)).toBe(true);
      expect(
        canStartWorkout({ ...jitter, angle: config.topAngle - 9 }, exercise, config, true),
      ).toBe(false);
      expect(canStartWorkout({ ...jitter, score: 64 }, exercise, config, true)).toBe(false);
      expect(canStartWorkout({ ...jitter, tracked: false }, exercise, config, true)).toBe(false);
      expect(canStartWorkout({ ...jitter, confidence: 0.64 }, exercise, config, true)).toBe(false);
    },
  );

  it('continues an aligned plank through score jitter while rejecting sagging or missing geometry', () => {
    const config = defaultWorkoutConfig('plank');
    const jitter = readyPose('plank', { angle: 160, score: 65 });
    expect(canStartWorkout(jitter, 'plank', config)).toBe(false);
    expect(canStartWorkout(jitter, 'plank', config, true)).toBe(true);
    expect(canStartWorkout({ ...jitter, angle: 159 }, 'plank', config, true)).toBe(false);
    expect(canStartWorkout({ ...jitter, phase: 'adjusting' }, 'plank', config, true)).toBe(false);
    expect(canStartWorkout({ ...jitter, angle: null }, 'plank', config, true)).toBe(false);
  });
});
