import { describe, expect, it } from 'vitest';
import { analyzePose, initialPoseState, type Landmark } from '../src/lib/pose-engine';
import { defaultWorkoutConfig } from '../src/lib/workout-config';
import { canStartWorkout } from '../src/lib/workout-start';
import {
  advanceMovementCalibration,
  beginMovementCalibration,
} from '../src/lib/movement-calibration';
import { initialPoseContinuity, validatePoseContinuity } from '../src/lib/pose-continuity';
import { initialJointStability, stabilizePoseJoints } from '../src/lib/pose-joints';
import {
  initialTrainingMetrics,
  observeTrainingMetrics,
  trainingMetricsSummary,
} from '../src/lib/training-metrics';

// Orthographic projection of constant-length articulated arms. Unlike the old
// fixtures, the image and depth move together, including a foreshortened wrist.
function frontCurl(angle: number, width: number, height: number, armLean = 0, roll = 0) {
  const radians = Math.PI / 180;
  const world: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.98,
    presence: 0.98,
  }));
  for (const side of [0, 1]) {
    const x = side ? 0.18 : -0.18;
    const arm = armLean * radians;
    const bend = (angle - armLean) * radians;
    Object.assign(world[11 + side], { x, y: -0.45 });
    Object.assign(world[23 + side], { x, y: 0 });
    Object.assign(world[13 + side], {
      x,
      y: -0.45 + 0.26 * Math.cos(arm),
      z: -0.26 * Math.sin(arm),
    });
    Object.assign(world[15 + side], {
      x,
      y: world[13 + side].y - 0.24 * Math.cos(bend),
      z: world[13 + side].z! - 0.24 * Math.sin(bend),
    });
    Object.assign(world[25 + side], { x, y: 0.25 });
    Object.assign(world[27 + side], { x, y: 0.5 });
  }
  for (const p of world) {
    const { x, y } = p;
    p.x = x * Math.cos(roll * radians) - y * Math.sin(roll * radians);
    p.y = x * Math.sin(roll * radians) + y * Math.cos(roll * radians);
  }
  const scale = Math.min(width, height) * 0.7;
  const image = world.map((p) => ({
    ...p,
    x: 0.5 + (p.x * scale) / width,
    y: 0.5 + (p.y * scale) / height,
  }));
  return { image, world };
}

describe('front-camera measurement reliability', () => {
  it.each(['left', 'right'] as const)(
    'counts the moving %s arm at irregular frame intervals',
    (active) => {
      const state = initialPoseState();
      const intervals = [45, 100, 65, 130, 55, 80];
      let at = 100,
        index = 0;
      while (at <= 12000) {
        const angle =
          at < 1000 || at > 11000 ? 170 : 125 + 45 * Math.cos(((at - 1000) / 2000) * Math.PI * 2);
        const current = frontCurl(angle, 1280, 720),
          idle = frontCurl(170, 1280, 720);
        const inactive = active === 'left' ? 1 : 0;
        for (const joint of [11, 13, 15, 23, 25, 27]) {
          current.image[joint + inactive] = idle.image[joint + inactive];
          current.world[joint + inactive] = idle.world[joint + inactive];
        }
        analyzePose([current.image], 'curl', state, at, 1280, 720, false, {}, [current.world]);
        at += intervals[index++ % intervals.length];
      }
      expect(state.reps).toBe(5);
      expect(state.side).toBe(active === 'left' ? 0 : 1);
    },
  );
  it.each([8, 12, 20, 30])(
    'counts observed near-threshold curls at %i FPS on both camera shapes',
    (fps) => {
      for (const [width, height] of [
        [390, 844],
        [1280, 720],
      ]) {
        const state = initialPoseState();
        const continuity = initialPoseContinuity(),
          joints = initialJointStability();
        const observe = (angle: number, at: number) => {
          const { image, world } = frontCurl(angle, width, height);
          const accepted = validatePoseContinuity(continuity, [image], [world], at, width, height);
          expect(accepted.resetRequired).toBe(false);
          const stable = stabilizePoseJoints(
            joints,
            accepted.poses,
            accepted.worldPoses,
            at,
            width,
            height,
          );
          return analyzePose(
            stable.poses,
            'curl',
            state,
            at,
            width,
            height,
            false,
            { side: 'right' },
            stable.worldPoses,
          );
        };
        for (let i = 0; i < fps; i++) observe(150, 100 + (i * 1000) / fps);
        // The configured 145/85 endpoints have a 6-degree measurement band.
        // The observed excursion is still > 45 degrees and lasts two seconds.
        for (let i = 0; i <= fps * 6; i++) {
          const angle = 115.5 + 27.5 * Math.cos((i / (2 * fps)) * Math.PI * 2);
          observe(angle, 1100 + (i * 1000) / fps);
        }
        expect(state.reps).toBe(3);
      }
    },
  );
  it('penalizes an upper arm raised toward the camera, which looks vertical in 2D', () => {
    const read = (lean: number) => {
      const { image, world } = frontCurl(90, 390, 844, lean);
      return analyzePose([image], 'curl', initialPoseState(), 100, 390, 844, false, {}, [world]);
    };
    expect(read(0).score).toBeGreaterThan(85);
    expect(read(50).score).toBeLessThan(75);
    expect(read(50).cue).toContain('upper arm');
  });
  it('compares the upper arm to the torso instead of penalizing camera roll as arm swing', () => {
    const score = (roll: number) => {
      const { image, world } = frontCurl(90, 1280, 720, 0, roll);
      return analyzePose([image], 'curl', initialPoseState(), 100, 1280, 720, false, {}, [world])
        .score!;
    };
    expect(Math.abs(score(0) - score(35))).toBeLessThanOrEqual(3);
  });
  it('does not report a high curl score for an inverted upper arm', () => {
    const { image, world } = frontCurl(90, 1280, 720, 155);
    const result = analyzePose([image], 'curl', initialPoseState(), 100, 1280, 720, false, {}, [
      world,
    ]);
    expect(result.score === null || result.score < 50).toBe(true);
  });
  it('does not discard a cycle because a duplicate frame arrived', () => {
    const state = initialPoseState();
    const angles = [170, 170, 150, 125, 100, 75, 75, 100, 125, 150, 170, 170];
    angles.forEach((angle, i) => {
      const { image, world } = frontCurl(angle, 390, 844);
      analyzePose([image], 'curl', state, 100 + i * 100, 390, 844, false, {}, [world]);
      if (i === 6) analyzePose([image], 'curl', state, 100 + i * 100, 390, 844, false, {}, [world]);
    });
    expect(state.reps).toBe(1);
  });
  it('penalizes torso sway relative to the starting posture, without penalizing a fixed camera tilt', () => {
    const state = initialPoseState();
    let result;
    for (let i = 0; i < 30; i++) {
      const { image, world } = frontCurl(160, 1280, 720, 0, i < 10 ? 0 : 30);
      result = analyzePose([image], 'curl', state, 100 + i * 100, 1280, 720, false, {}, [world]);
    }
    expect(result!.score).toBeLessThan(75);
    expect(result!.cue).toContain('torso');
  });
  it.each([98, 115, 139])(
    'does not turn partial curls with a %i-degree minimum into reps',
    (minimum) => {
      const state = initialPoseState();
      for (let i = 0; i < 160; i++) {
        const angle =
          (170 + minimum) / 2 + ((170 - minimum) / 2) * Math.cos((i / 40) * Math.PI * 2);
        const { image, world } = frontCurl(angle, 390, 844);
        analyzePose([image], 'curl', state, 100 + i * 50, 390, 844, false, {}, [world]);
      }
      expect(state.reps).toBe(0);
    },
  );
  it('keeps a calibrated 2D range in 2D when depth becomes available', () => {
    const { image, world } = frontCurl(120, 390, 844);
    const result = analyzePose(
      [image],
      'curl',
      initialPoseState(),
      100,
      390,
      844,
      false,
      { side: 'right', calibrationSource: '2d' },
      [world],
    );
    expect(result.geometrySource).toBe('2d');
  });
  it('does not silently apply a calibrated depth range to projected image angles', () => {
    const { image } = frontCurl(170, 390, 844);
    const result = analyzePose([image], 'curl', initialPoseState(), 100, 390, 844, false, {
      side: 'right',
      calibrationSource: '3d',
    });
    expect(result.tracked).toBe(false);
    expect(result.cue).toContain('calibrated depth');
  });
  it('does not count a horizontal press as an overhead press', () => {
    const state = initialPoseState();
    for (let i = 0; i < 60; i++) {
      const angle = i < 15 || i >= 40 ? 80 : 170;
      const { image, world } = frontCurl(angle, 1280, 720, 90);
      // Upper arm toward camera at shoulder height: elbow extends, but the
      // hand never reaches the required overhead endpoint.
      analyzePose([image], 'shoulderpress', state, 100 + i * 100, 1280, 720, false, {}, [world]);
    }
    expect(state.reps).toBe(0);
  });
});

it('retains measured range and tempo when form scoring is unsupported', () => {
  const metrics = initialTrainingMetrics();
  observeTrainingMetrics(
    metrics,
    {
      reps: 1,
      holdSeconds: 0,
      tracked: true,
      confidence: 0.95,
      score: null,
      lastRepQuality: null,
      rangeDegrees: 40,
      lastRepSeconds: 2,
      phase: '',
      cue: '',
      angle: 120,
      ruleVersion: 'test',
    },
    100,
  );
  expect(trainingMetricsSummary(metrics)).toMatchObject({
    qualityScore: null,
    formScore: null,
    rangeDegrees: 40,
    repSeconds: 2,
  });
});

it('starts a recognized posture without requiring a fabricated form score', () => {
  expect(
    canStartWorkout(
      {
        reps: 0,
        holdSeconds: 0,
        tracked: true,
        postureValid: true,
        confidence: 0.95,
        score: null,
        phase: 'start position',
        cue: '',
        angle: 120,
        ruleVersion: 'test',
      },
      'glutebridge',
      defaultWorkoutConfig('glutebridge'),
    ),
  ).toBe(true);
});

it('uses the configured hold angle consistently for initial and continuing countdowns', () => {
  const config = { ...defaultWorkoutConfig('plank'), topAngle: 150 };
  const result = {
    reps: 0,
    holdSeconds: 0,
    score: 90,
    confidence: 0.95,
    phase: 'holding',
    cue: '',
    angle: 152,
    tracked: true,
    ruleVersion: 'test',
  };
  expect(canStartWorkout(result, 'plank', config)).toBe(true);
  expect(canStartWorkout(result, 'plank', config, true)).toBe(true);
  // A recognized 152-degree body line scores below 75 in the alignment rule.
  // The numeric estimate must not override the explicitly accepted hold range.
  expect(canStartWorkout({ ...result, score: 54, postureValid: true }, 'plank', config)).toBe(true);
  expect(canStartWorkout({ ...result, angle: 152 }, 'plank', { ...config, topAngle: 165 })).toBe(
    false,
  );
});

it('calibrates a 31-degree hip excursion without the arbitrary 33-degree rejection', () => {
  let calibration = beginMovementCalibration(0);
  for (let at = 3000; at <= 8000; at += 100) {
    const analysis = {
      reps: 0,
      holdSeconds: 0,
      score: 90,
      confidence: 0.95,
      phase: 'moving',
      cue: '',
      angle: at < 4500 ? 126 : 95,
      tracked: true,
      ruleVersion: 'test',
      trackedSide: 'left' as const,
      geometrySource: '2d' as const,
    };
    calibration = advanceMovementCalibration(calibration, analysis, at, 'crunch');
  }
  expect(calibration.phase).toBe('complete');
  expect(calibration.range!.topAngle).toBeLessThanOrEqual(126);
  expect(calibration.range!.bottomAngle).toBeGreaterThanOrEqual(95);
});

it('does not calibrate an invalid exercise posture when no form score is available', () => {
  let calibration = beginMovementCalibration(0);
  for (let at = 3000; at <= 6000; at += 100)
    calibration = advanceMovementCalibration(
      calibration,
      {
        reps: 0,
        holdSeconds: 0,
        tracked: true,
        postureValid: false,
        confidence: 0.95,
        score: null,
        phase: 'moving',
        cue: '',
        angle: 120,
        ruleVersion: 'test',
      },
      at,
      'glutebridge',
    );
  expect(calibration.phase).toBe('start');
  expect(calibration.startAngle).toBeNull();
});
