import { describe, expect, it } from 'vitest';
import { analyzePose, initialPoseState, type Landmark } from '../src/lib/pose-engine';
import {
  exerciseIds,
  getExerciseProfile,
  isHoldAngle,
  LEGACY_AUTOMATIC_IDS,
  type ProfileExerciseId,
} from '../src/lib/exercise-profiles';
import {
  exerciseDefinition,
  exerciseLibrary,
  isAutomaticExercise,
  limbModeLabel,
} from '../src/lib/exercise-library';
import { normalizeWorkoutConfig } from '../src/lib/workout-config';
import { coordinateReps, initialRepCoordinator } from '../src/lib/rep-events';

// Synthetic stick figures: pipeline evidence for each profile's geometry and
// gates. They are not accuracy evidence for real bodies, cameras or devices.
const W = 640,
  H = 480;
type P = { x: number; y: number };
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Direction in degrees clockwise from straight up on screen. */
const step = (from: P, length: number, dir: number): P => ({
  x: from.x + Math.sin(rad(dir)) * length,
  y: from.y - Math.cos(rad(dir)) * length,
});
function landmarks(points: Record<number, P>, offset = 4): Landmark[] {
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.95,
    presence: 0.95,
  }));
  for (const [key, p] of Object.entries(points)) {
    const index = Number(key);
    pose[index] = { x: p.x / W, y: p.y / H, visibility: 0.95, presence: 0.95 };
    // Side view: the far limb nearly overlaps the near limb.
    if (index % 2 === 1 && points[index + 1] === undefined)
      pose[index + 1] = { x: (p.x + offset) / W, y: p.y / H, visibility: 0.95, presence: 0.95 };
  }
  return pose;
}
type Builder = (value: number) => Landmark[];

/** Side view standing figure; `knee` is the knee angle, `lean` the torso lean. */
const legs = (knee: number, lean = 8): Landmark[] => {
  const hip = { x: 320, y: 250 };
  const bend = (180 - knee) / 2;
  const kneePoint = step(hip, 100, 180 - bend);
  const shoulder = step(hip, 120, lean);
  const elbow = step(shoulder, 60, 170);
  return landmarks({
    11: shoulder,
    13: elbow,
    15: step(elbow, 50, 120),
    23: hip,
    25: kneePoint,
    27: step(kneePoint, 100, 180 + bend),
  });
};
/** Side view push-up; `elbow` is the elbow angle, `slope` raises the shoulders. */
const pushup =
  (slope = 0, knees = false): Builder =>
  (elbowAngle) => {
    const hip = { x: 340, y: 300 };
    const shoulder = step(hip, 130, 270 + slope);
    const turn = (180 - elbowAngle) / 2;
    const elbow = step(shoulder, 55, 180 + turn);
    const knee = step(hip, knees ? 95 : 100, 90 + slope);
    return landmarks({
      11: shoulder,
      13: elbow,
      15: step(elbow, 55, 180 - turn),
      23: hip,
      25: knee,
      27: knees ? step(knee, 90, 20) : step(knee, 100, 90 + slope),
    });
  };
/** Side view arm on an upright trunk; `upper` is the upper-arm direction. */
const arm =
  (upper: (v: number) => number, fore: (v: number) => number): Builder =>
  (v) => {
    const hip = { x: 320, y: 300 };
    const shoulder = step(hip, 130, 3);
    const elbow = step(shoulder, 60, upper(v));
    const knee = step(hip, 100, 180);
    return landmarks({
      11: shoulder,
      13: elbow,
      15: step(elbow, 50, fore(v)),
      23: hip,
      25: knee,
      27: step(knee, 100, 180),
    });
  };
/** Side view hinge; `hip` is the shoulder-hip-knee angle, `knee` the knee angle (fixed or per hip angle). */
const hinge =
  (kneeAt: number | ((hipAngle: number) => number) = 165): Builder =>
  (hipAngle) => {
    const knee = typeof kneeAt === 'number' ? kneeAt : kneeAt(hipAngle);
    const hip = { x: 320, y: 230 };
    const thigh = 180 - (180 - knee) / 2;
    const kneePoint = step(hip, 100, thigh);
    // The hip angle sits between the thigh and the forward-leaning trunk.
    const shoulder = step(hip, 120, thigh - hipAngle);
    return landmarks({
      11: shoulder,
      13: step(shoulder, 60, 180),
      15: step(step(shoulder, 60, 180), 50, 180),
      23: hip,
      25: kneePoint,
      27: step(kneePoint, 100, 180 + (180 - knee) / 2),
    });
  };
/** Front view figure with both arms abducted by `abduction` and an ankle gap. */
const front = (abduction: number, ankleGap: number): Landmark[] => {
  const points: Record<number, P> = {};
  for (const [side, sign] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const shoulder = { x: 320 + sign * 50, y: 120 };
    const elbow = step(shoulder, 60, 180 - sign * abduction);
    points[11 + side] = shoulder;
    points[13 + side] = elbow;
    points[15 + side] = step(elbow, 50, 180 - sign * abduction);
    points[23 + side] = { x: 320 + sign * 35, y: 250 };
    points[25 + side] = { x: 320 + sign * 35, y: 340 };
    points[27 + side] = { x: 320 + (sign * ankleGap) / 2, y: 430 };
  }
  return landmarks(points);
};

function run(
  exercise: ProfileExerciseId,
  build: Builder,
  start: number,
  end: number,
  reps: number,
  options: { settings?: object; cycleMs?: number; world?: (v: number) => Landmark[] } = {},
) {
  const state = initialPoseState();
  const cycle = options.cycleMs ?? 1800;
  const fps = 30;
  const total = 600 + reps * cycle + 600;
  let last;
  for (let t = 0; t <= total; t += 1000 / fps) {
    const phase = t < 600 || t >= 600 + reps * cycle ? 0 : ((t - 600) % cycle) / cycle;
    const value = start + ((end - start) * (1 - Math.cos(phase * 2 * Math.PI))) / 2;
    last = analyzePose(
      [build(value)],
      exercise,
      state,
      100 + t,
      W,
      H,
      false,
      options.settings,
      options.world ? [options.world(value)] : undefined,
    );
  }
  return last!;
}

describe('extended automatic profiles (synthetic pipeline evidence)', () => {
  const cases: [ProfileExerciseId, Builder, number, number][] = [
    ['gobletsquat', (v) => legs(v), 172, 95],
    ['sumosquat', (v) => legs(v), 172, 100],
    ['reverselunge', (v) => legs(v), 172, 95],
    ['inclinepushup', pushup(35), 170, 90],
    ['kneepushup', pushup(0, true), 170, 90],
    [
      'frontraise',
      arm(
        (v) => 180 - v,
        (v) => 180 - v,
      ),
      12,
      90,
    ],
    [
      'bandrow',
      arm(
        (v) => 180 - (170 - v) / 2,
        (v) => 180 - (170 - v) / 2 - (180 - v),
      ),
      170,
      80,
    ],
    [
      'tricepsextension',
      arm(
        () => -8,
        (v) => -8 + (180 - v),
      ),
      65,
      165,
    ],
    ['romaniandeadlift', hinge(), 172, 95],
  ];
  for (const [exercise, build, start, end] of cases) {
    it(`counts complete ${exercise} cycles exactly and ignores half-range cycles`, () => {
      expect(run(exercise, build, start, end, 3).reps).toBe(3);
      expect(run(exercise, build, start, start + (end - start) * 0.35, 3).reps).toBe(0);
    });
  }

  it('counts hammer curls in each arm mode with curl phase names', () => {
    const curlArm = arm(
      () => 180,
      (v) => 180 - (180 - v),
    );
    expect(run('hammercurl', curlArm, 165, 60, 3, { settings: { side: 'left' } }).reps).toBe(3);
    const result = run('hammercurl', curlArm, 165, 60, 2, { settings: { armMode: 'left' } });
    expect(result.armMode).toBe('left');
    expect(result.arms?.left.reps).toBe(2);
    expect(result.reps).toBe(2);
  });

  it('rejects squats as Romanian deadlifts even though the knee straightens at the top', () => {
    // A real squat: the knee bends with the hip (172° → 90°) and is straight again when standing.
    const squat = hinge((hipAngle) => 172 - ((172 - hipAngle) * 82) / 77);
    const result = run('romaniandeadlift', squat, 172, 95, 3);
    expect(result.reps).toBe(0);
    expect(result.rejectionReason).toBe('form');
  });

  it('counts step jacks only when the feet open and close with the arms', () => {
    const open = (v: number) => front(v, v > 80 ? 105 : 30);
    expect(run('stepjack', open, 15, 150, 3).reps).toBe(3);
    expect(run('stepjack', (v) => front(v, 30), 15, 150, 3).reps).toBe(0);
  });

  it('accumulates wall-sit time only inside the knee-angle band', () => {
    const state = initialPoseState();
    let result;
    for (let t = 0; t <= 3000; t += 33)
      result = analyzePose([legs(90, 3)], 'wallsit', state, 100 + t, W, H);
    expect(result!.phase).toBe('holding');
    expect(result!.holdSeconds).toBeGreaterThanOrEqual(2);
    const standing = initialPoseState();
    for (let t = 0; t <= 3000; t += 33)
      result = analyzePose([legs(172, 3)], 'wallsit', standing, 100 + t, W, H);
    expect(result!.holdSeconds).toBe(0);
    const profile = getExerciseProfile('wallsit');
    expect(isHoldAngle(profile, { topAngle: 115, bottomAngle: 70 }, 60)).toBe(false);
    expect(isHoldAngle(getExerciseProfile('plank'), { topAngle: 160, bottomAngle: 135 }, 170)).toBe(
      true,
    );
  });

  describe('high knees', () => {
    // Front view: a knee lifted toward the camera barely changes the projected
    // hip angle, so the profile counts only from depth (world) landmarks.
    const flexion = (leg: 0 | 1, t: number) => {
      const cycle = 1000;
      if (t < 600) return 0;
      const phase = ((t - 600 + (leg ? cycle / 2 : 0)) % cycle) / cycle;
      return (75 * (1 - Math.cos(phase * 2 * Math.PI))) / 2;
    };
    const image = (t: number) => {
      const pose = front(10, 30);
      for (const leg of [0, 1] as const)
        pose[25 + leg] = { ...pose[25 + leg], y: (340 - 60 * Math.sin(rad(flexion(leg, t)))) / H };
      return pose;
    };
    const world = (t: number): Landmark[] =>
      Array.from({ length: 33 }, (_, index) => {
        const leg = index % 2 === 1 ? 0 : 1;
        const x = leg ? 0.15 : -0.15;
        const f = rad(flexion(leg as 0 | 1, t));
        if (index === 11 || index === 12) return { x, y: -0.5, z: 0, visibility: 0.95 };
        if (index === 23 || index === 24) return { x: x * 0.7, y: 0, z: 0, visibility: 0.95 };
        if (index === 25 || index === 26)
          return { x: x * 0.7, y: 0.45 * Math.cos(f), z: -0.45 * Math.sin(f), visibility: 0.95 };
        return { x: 0, y: 0.2, z: 0, visibility: 0.95 };
      });
    const drive = (withWorld: boolean, pairs: number) => {
      const state = initialPoseState();
      let result;
      for (let t = 0; t <= 600 + pairs * 1000 + 300; t += 1000 / 30)
        result = analyzePose(
          [image(t)],
          'highknees',
          state,
          100 + t,
          W,
          H,
          false,
          undefined,
          withWorld ? [world(t)] : undefined,
        );
      return result!;
    };

    it('runs in alternating leg mode and counts left+right pairs from depth', () => {
      const result = drive(true, 4);
      expect(result.armMode).toBe('alternating');
      expect(result.geometrySource).toBe('3d');
      expect(result.arms!.left.reps).toBeGreaterThanOrEqual(3);
      expect(result.arms!.right.reps).toBeGreaterThanOrEqual(3);
      expect(result.reps).toBe(Math.min(result.arms!.left.reps, result.arms!.right.reps));
    });

    it('never counts from projected 2D geometry', () => {
      const result = drive(false, 4);
      expect(result.reps).toBe(0);
      expect(result.cue).toMatch(/Depth tracking is unavailable/);
    });
  });
});

describe('extended catalog contract', () => {
  it('keeps 36 definitions, 25 automatic beta, 11 manual or timed, none validated', () => {
    expect(exerciseLibrary).toHaveLength(36);
    expect(new Set(exerciseLibrary.map((e) => e.id)).size).toBe(36);
    expect(exerciseLibrary.filter((e) => e.capability === 'beta')).toHaveLength(25);
    expect(exerciseLibrary.filter((e) => e.capability === 'validated')).toHaveLength(0);
    expect(exerciseIds).toHaveLength(25);
    for (const id of ['laterallunge', 'calfraise', 'stepup', 'birddog', 'catcow'])
      expect(isAutomaticExercise(id)).toBe(false);
  });
  it('keeps the legacy client gate on the original 12 profiles', () => {
    expect(LEGACY_AUTOMATIC_IDS).toHaveLength(12);
    expect(LEGACY_AUTOMATIC_IDS.includes('gobletsquat')).toBe(false);
    for (const id of LEGACY_AUTOMATIC_IDS) expect(isAutomaticExercise(id)).toBe(true);
  });
  it('gives curl modes to both curls and a fixed alternating leg mode to high knees', () => {
    expect(exerciseDefinition('hammercurl').modes).toEqual(exerciseDefinition('curl').modes);
    expect(exerciseDefinition('highknees').modes).toEqual(['alternating']);
    expect(normalizeWorkoutConfig('highknees', {}).armMode).toBe('alternating');
    expect(normalizeWorkoutConfig('highknees', { armMode: 'both' }).armMode).toBe('alternating');
    expect(normalizeWorkoutConfig('squat', { armMode: 'left' }).armMode).toBeUndefined();
    expect(limbModeLabel('highknees', 'alternating')).toBe('Alternating · per leg');
    expect(limbModeLabel('curl', 'alternating')).toBe('Alternating · per arm');
  });
  it('uses leg wording in coordination cues for leg modes', () => {
    const state = initialRepCoordinator();
    const event = (id: string) => ({
      id,
      side: 'left' as const,
      startedAt: 0,
      endedAt: 10,
      observedMs: 10,
      rangeDegrees: 40,
      quality: null,
    });
    coordinateReps(state, 'alternating', [event('a')], 10, 'leg');
    coordinateReps(state, 'alternating', [event('b')], 20, 'leg');
    expect(state.sequenceCue).toBe('Alternate legs. Your left movement was recorded.');
  });
});
