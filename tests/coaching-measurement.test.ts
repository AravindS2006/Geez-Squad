import { describe, expect, it } from 'vitest';
import { analyzePose, initialPoseState, type Landmark } from '../src/lib/pose-engine';
import { jointAngle } from '../src/lib/pose-geometry';
import {
  coordinateReps,
  emptyArm,
  initialRepCoordinator,
  type RepEvent,
} from '../src/lib/rep-events';
import {
  initialTrainingMetrics,
  observeTrainingMetrics,
  trainingMetricsSummary,
} from '../src/lib/training-metrics';
import { exerciseLibrary, isAutomaticExercise } from '../src/lib/exercise-library';
import { planBlocks, setArms } from '../src/lib/workout-run';
import { initialPoseContinuity, validatePoseContinuity } from '../src/lib/pose-continuity';
import { initialJointStability, stabilizePoseJoints } from '../src/lib/pose-joints';
import { measurementSchema } from '../src/lib/measurement-contract';

export function curlPose(left: number, right: number): Landmark[] {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.95,
    presence: 0.95,
  }));
  for (const [side, angle] of [left, right].entries()) {
    const x = side ? 0.7 : 0.3,
      rad = (angle * Math.PI) / 180;
    pose[11 + side] = { x, y: 0.2, visibility: 0.95, presence: 0.95 };
    pose[13 + side] = { x, y: 0.42, visibility: 0.95, presence: 0.95 };
    pose[15 + side] = {
      x: x + (Math.sin(rad) * 0.22 * 480) / 640,
      y: 0.42 - Math.cos(rad) * 0.22,
      visibility: 0.95,
      presence: 0.95,
    };
    pose[23 + side] = { x, y: 0.65, visibility: 0.95, presence: 0.95 };
  }
  return pose;
}
function sequence(
  mode: 'left' | 'right' | 'both' | 'alternating',
  move: (i: number) => [number, number],
  count = 3,
) {
  const state = initialPoseState(),
    continuity = initialPoseContinuity(),
    joints = initialJointStability();
  for (let i = 0; i <= count * 48 + 10; i++) {
    const [l, r] = move(i),
      t = 100 + (i * 1000) / 24;
    const observation = validatePoseContinuity(
      continuity,
      [curlPose(l, r)],
      undefined,
      t,
      640,
      480,
    );
    const stable = stabilizePoseJoints(
      joints,
      observation.poses,
      observation.worldPoses,
      t,
      640,
      480,
    );
    analyzePose(
      stable.poses,
      'curl',
      state,
      t,
      640,
      480,
      false,
      { armMode: mode },
      stable.worldPoses,
    );
  }
  return state;
}
const angle = (i: number) => 85 + 85 * Math.cos((i / 48) * Math.PI * 2);
const event = (
  side: 'left' | 'right',
  start: number,
  end: number,
  id = `${side}:${end}`,
): RepEvent => ({
  id,
  side,
  startedAt: start,
  endedAt: end,
  observedMs: end - start,
  rangeDegrees: 100,
  quality: null,
});

describe('explicit arm counting through the observation pipeline', () => {
  it('accepts wrist–shoulder overlap as a zero-degree elbow, while rejecting a collapsed forearm', () => {
    const p = curlPose(0, 170);
    expect(jointAngle(p[11], p[13], p[15])).toBeCloseTo(0);
    expect(jointAngle(p[11], p[13], p[13])).toBeNull();
  });
  it.each(['left', 'right'] as const)(
    'counts deep %s curls through exact wrist–shoulder overlap',
    (mode) => {
      const s = sequence(mode, (i) => (mode === 'left' ? [angle(i), 170] : [170, angle(i)]));
      expect(s.reps).toBe(3);
      expect(s.armTotals?.[mode].reps).toBe(3);
    },
  );
  it('does not advance a left-arm target from right-arm movement', () => {
    expect(sequence('left', (i) => [170, angle(i)]).reps).toBe(0);
  });
  it('counts both together once, retaining both arm totals', () => {
    const s = sequence('both', (i) => [angle(i), angle(i)]);
    expect(s.reps).toBe(3);
    expect(s.armTotals?.left.reps).toBe(3);
    expect(s.armTotals?.right.reps).toBe(3);
  });
  it('does not let a single arm advance a bilateral target', () => {
    const s = sequence('both', (i) => [angle(i), 170]);
    expect(s.reps).toBe(0);
    expect(s.armTotals?.left.reps).toBe(3);
  });
  it('requires each arm for alternating progress', () => {
    const s = sequence('alternating', (i) => [angle(i), 170]);
    expect(s.reps).toBe(0);
    expect(s.armTotals?.left.reps).toBe(3);
    expect(s.coordinator?.sequenceCue).toContain('Alternate');
  });
  it('freezes a hidden right arm while preserving the left movement', () => {
    const state = initialPoseState();
    for (let i = 0; i <= 58; i++) {
      const p = curlPose(angle(i), angle(i));
      p[16].visibility = 0;
      analyzePose([p], 'curl', state, 100 + (i * 1000) / 24, 640, 480, false, { armMode: 'both' });
    }
    expect(state.reps).toBe(0);
    expect(state.armTotals?.left.reps).toBe(1);
    expect(state.armTotals?.right.reps).toBe(0);
  });
});
describe('repetition event coordination', () => {
  it('does not let a prior set arm imbalance advance the next alternating target', () => {
    const state = sequence('alternating', (i) => [angle(i), 170], 1);
    expect(state.armTotals?.left.reps).toBe(1);
    state.armBaseline = { left: 1, right: 0, reps: 0 };
    const start = state.lastTimestamp + 100;
    for (let i = 0; i <= 58; i++)
      analyzePose(
        [curlPose(170, angle(i))],
        'curl',
        state,
        start + (i * 1000) / 24,
        640,
        480,
        false,
        { armMode: 'alternating' },
      );
    expect(state.armTotals?.right.reps).toBe(1);
    expect(state.reps).toBe(0);
  });
  it('preserves anatomical left when the image is reflected', () => {
    const state = initialPoseState();
    for (let i = 0; i <= 58; i++) {
      const pose = curlPose(angle(i), 170).map((point) => ({ ...point, x: 1 - point.x }));
      analyzePose([pose], 'curl', state, 100 + (i * 1000) / 24, 640, 480, false, {
        armMode: 'left',
      });
    }
    expect(state.reps).toBe(1);
    expect(state.armTotals?.left.reps).toBe(1);
    expect(state.armTotals?.right.reps).toBe(0);
  });
  it('rejects a curl when the torso orientation is incompatible with the exercise', () => {
    const state = initialPoseState();
    for (let i = 0; i <= 58; i++) {
      const pose = curlPose(angle(i), 170).map((point) => ({ ...point, y: 1 - point.y }));
      analyzePose([pose], 'curl', state, 100 + (i * 1000) / 24, 640, 480, false, {
        armMode: 'left',
      });
    }
    expect(state.reps).toBe(0);
  });
  it('normalizes fractional frame durations without rejecting valid arm summaries', () => {
    const arm = { ...emptyArm(), activeMs: 1000.75, trackedMs: 990.25 };
    const value = measurementSchema.parse({ arms: { left: arm, right: arm } });
    expect(value.arms?.left.activeMs).toBe(1001);
    expect(value.arms?.right.trackedMs).toBe(990);
  });
  it('does not pair sequential curls even if their finish timestamps are close', () => {
    const s = initialRepCoordinator();
    coordinateReps(s, 'both', [event('left', 0, 1000), event('right', 1100, 1600)], 1600);
    expect(s.pairs).toBe(0);
  });
  it('pairs overlapping movements within tolerance exactly once', () => {
    const s = initialRepCoordinator(),
      events = [event('left', 0, 1000), event('right', 200, 1600)];
    coordinateReps(s, 'both', events, 1600);
    coordinateReps(s, 'both', events, 1650);
    expect(s.pairs).toBe(1);
  });
  it('expires unmatched events instead of counting a later arm', () => {
    const s = initialRepCoordinator();
    coordinateReps(s, 'both', [event('left', 0, 1000)], 1000);
    coordinateReps(s, 'both', [event('right', 200, 1800)], 1800);
    expect(s.pairs).toBe(0);
  });
  it('aggregates two events in one frame without dropping range/tempo or duplicating retries', () => {
    const s = initialTrainingMetrics();
    const a = {
      reps: 1,
      holdSeconds: 0,
      score: null,
      confidence: 1,
      phase: 'arm extended',
      cue: '',
      angle: 170,
      tracked: true,
      ruleVersion: 'profile-v8',
      repEvents: [event('left', 0, 1000), event('right', 100, 1100)],
    };
    observeTrainingMetrics(s, a, 1100);
    observeTrainingMetrics(s, a, 1200);
    expect(s.repSamples).toBe(2);
    expect(trainingMetricsSummary(s).repSeconds).toBe(1);
  });
  it('subtracts per-set arm baselines without mutating prior summaries', () => {
    const arms = { left: { ...emptyArm(), reps: 13 }, right: { ...emptyArm(), reps: 10 } };
    const baseline = { left: { ...emptyArm(), reps: 3 }, right: emptyArm() };
    expect(setArms(arms, baseline)?.left.reps).toBe(10);
    expect(arms.left.reps).toBe(13);
  });
  it('has 36 definitions and never promotes manual exercises by name similarity', () => {
    expect(exerciseLibrary).toHaveLength(36);
    expect(exerciseLibrary.filter((e) => e.capability === 'validated')).toHaveLength(0);
    expect(isAutomaticExercise('hammercurl')).toBe(false);
    expect(isAutomaticExercise('custom:curl')).toBe(false);
  });
  it('gives repeated legacy exercise blocks different stable identities', () => {
    const plan = {
      id: 'plan',
      blocks: [
        { exercise: 'curl' as const, sets: 1, reps: 10, rest: 0 },
        { exercise: 'curl' as const, sets: 1, reps: 10, rest: 0 },
      ],
    };
    expect(planBlocks(plan).map((b) => b.id)).toEqual(['plan:0', 'plan:1']);
  });
});
