import { describe, expect, it } from 'vitest';
import {
  analyzePose,
  initialPoseState,
  type Landmark,
  type PoseState,
} from '../src/lib/pose-engine';
import { getExerciseProfile, type ProfileExerciseId } from '../src/lib/exercise-profiles';

const W = 640,
  H = 480;
function curl(angle: number, armLean = 0): Landmark[] {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.95,
    presence: 0.95,
  }));
  for (const side of [0, 1]) {
    const x = 0.5 + side * 0.01;
    const arm = (armLean * Math.PI) / 180;
    const radians = ((angle - armLean) * Math.PI) / 180;
    pose[11 + side] = { x, y: 0.2, visibility: 0.95, presence: 0.95 };
    pose[13 + side] = {
      x: x + (Math.sin(arm) * 0.22 * H) / W,
      y: 0.2 + Math.cos(arm) * 0.22,
      visibility: 0.95,
      presence: 0.95,
    };
    pose[15 + side] = {
      x: pose[13 + side].x + (Math.sin(radians) * 0.18 * H) / W,
      y: pose[13 + side].y - Math.cos(radians) * 0.18,
      visibility: 0.95,
      presence: 0.95,
    };
    pose[23 + side] = { x, y: 0.65, visibility: 0.95, presence: 0.95 };
    pose[25 + side] = { x, y: 0.77, visibility: 0.95, presence: 0.95 };
    pose[27 + side] = { x, y: 0.92, visibility: 0.95, presence: 0.95 };
  }
  return pose;
}
function frame(state: PoseState, angle: number, timestamp: number, pose = curl(angle)) {
  return analyzePose([pose], 'curl', state, timestamp, W, H);
}
function continuousCurls(fps: number, count: number, side: 'left' | 'right' | 'auto' = 'auto') {
  const state = initialPoseState();
  const framesPerRep = Math.round(fps * 1.8);
  for (let index = 0; index <= count * framesPerRep + Math.ceil(fps / 2); index++) {
    const angle = 125 + 45 * Math.cos((index / framesPerRep) * Math.PI * 2);
    analyzePose([curl(angle)], 'curl', state, 100 + (index * 1000) / fps, W, H, false, { side });
  }
  return state;
}

function phoneFrontCurl(
  angle: number,
  active: 'left' | 'right' | 'both',
  depth = false,
  angled = false,
) {
  const image = curl(170),
    world = image.map((point) => ({ ...point, z: 0 }));
  for (const side of [0, 1]) {
    const x = side === 0 ? 0.3 : 0.7;
    const current = active === 'both' || active === (side === 0 ? 'left' : 'right') ? angle : 170;
    const radians = (current * Math.PI) / 180;
    const offsetY = angled && side === 1 ? 0.035 : 0;
    image[11 + side] = { x, y: 0.2 + offsetY, visibility: 0.95, presence: 0.95 };
    image[13 + side] = { x, y: 0.42 + offsetY, visibility: 0.95, presence: 0.95 };
    image[23 + side] = { x, y: 0.65 + offsetY, visibility: 0.95, presence: 0.95 };
    image[15 + side] = depth
      ? {
          x: x + (side === 0 ? 0.005 : -0.005),
          y: 0.56 + offsetY,
          visibility: 0.95,
          presence: 0.95,
        }
      : {
          x: x + ((side === 0 ? 1 : -1) * Math.sin(radians) * 0.1 * 844) / 390,
          y: 0.42 + offsetY - Math.cos(radians) * 0.1,
          visibility: 0.95,
          presence: 0.95,
        };
    world[11 + side] = {
      x: side === 0 ? -0.15 : 0.15,
      y: -0.45,
      z: 0,
      visibility: 0.95,
      presence: 0.95,
    };
    world[13 + side] = { x: world[11 + side].x, y: -0.23, z: 0, visibility: 0.95, presence: 0.95 };
    world[23 + side] = { x: world[11 + side].x, y: 0, z: 0, visibility: 0.95, presence: 0.95 };
    world[15 + side] = {
      x: world[11 + side].x,
      y: -0.23 - Math.cos(radians) * 0.18,
      z: -Math.sin(radians) * 0.18,
      visibility: 0.95,
      presence: 0.95,
    };
  }
  return { image, world };
}

describe('profile v3 movement pipeline', () => {
  it('retains a completed curl after one noisy form frame but rejects sustained poor alignment', () => {
    const state = initialPoseState();
    for (let index = 0; index <= 60; index++) {
      const angle = 125 + 45 * Math.cos((index / 48) * Math.PI * 2);
      const pose = curl(angle);
      // Simulate one hip detection error, keeping the moving arm geometry intact.
      if (index === 25) for (const side of [0, 1]) pose[23 + side].x += 0.4;
      frame(state, angle, 100 + (index * 1000) / 24, pose);
    }
    expect(state.reps).toBe(1);
    expect(state.cycleInvalidMs).toBeLessThan(150);
  });
  it('rejects low-confidence depth points while reliable image geometry remains available', () => {
    const { image, world } = phoneFrontCurl(170, 'right');
    world[13].visibility = world[14].visibility = 0.2;
    const result = analyzePose([image], 'curl', initialPoseState(), 100, 390, 844, false, {}, [
      world,
    ]);
    expect(result.geometrySource).toBe('2d');
  });
  it.each([15, 24, 30])('counts ten continuous curls at %i fps without an endpoint hold', (fps) => {
    const state = continuousCurls(fps, 10);
    expect(state.reps).toBe(10);
    expect(state.lastRange).toBeGreaterThan(60);
    expect(state.lastRepQuality).toBeGreaterThan(85);
  });
  it.each(['left', 'right'] as const)('counts ten curls using the configured %s arm', (side) => {
    const state = continuousCurls(24, 10, side);
    expect(state.reps).toBe(10);
    expect(state.side).toBe(side === 'left' ? 0 : 1);
  });
  it.each(['left', 'right', 'both'] as const)(
    'counts ten front-facing phone curls with %s arm motion and automatic limb choice',
    (active) => {
      const state = initialPoseState();
      for (let index = 0; index <= 10 * 48 + 12; index++) {
        const { image } = phoneFrontCurl(125 + 45 * Math.cos((index / 48) * Math.PI * 2), active);
        const result = analyzePose([image], 'curl', state, 100 + (index * 1000) / 24, 390, 844);
        expect(result.tracked).toBe(true);
      }
      expect(state.reps).toBe(10);
      if (active !== 'both') expect(state.side).toBe(active === 'left' ? 0 : 1);
    },
  );
  it.each([15, 24, 30])(
    'counts ten depth-motion phone curls at %i fps even when 2D elbow angles barely move',
    (fps) => {
      const state = initialPoseState();
      const period = Math.round(fps * 1.8);
      let result;
      for (let index = 0; index <= 10 * period + Math.ceil(fps / 2); index++) {
        const { image, world } = phoneFrontCurl(
          125 + 45 * Math.cos((index / period) * Math.PI * 2),
          'right',
          true,
        );
        result = analyzePose(
          [image],
          'curl',
          state,
          100 + (index * 1000) / fps,
          390,
          844,
          false,
          {},
          [world],
        );
      }
      expect(state.reps).toBe(10);
      expect(state.side).toBe(1);
      expect(result!.trackedSide).toBe('right');
      expect(result!.geometrySource).toBe('3d');
    },
  );
  it.each([10, 15, 24, 30])('counts ten continuous 0.8-second phone curls at %i fps', (fps) => {
    const state = initialPoseState();
    const period = Math.round(fps * 0.8);
    for (let index = 0; index <= 10 * period + 2; index++) {
      const { image, world } = phoneFrontCurl(
        125 + 45 * Math.cos((index / period) * Math.PI * 2),
        'right',
        true,
      );
      analyzePose([image], 'curl', state, 100 + (index * 1000) / fps, 390, 844, false, {}, [world]);
    }
    expect(state.reps).toBe(10);
  });
  it('does not infer a start on an unseen curled arm when world tracking first becomes available', () => {
    const state = initialPoseState();
    for (let index = 0; index < 40; index++) {
      const { image, world } = phoneFrontCurl(index < 20 ? 80 : 170, 'right', true);
      analyzePose([image], 'curl', state, 100 + (index * 1000) / 24, 390, 844, false, {}, [world]);
    }
    expect(state.reps).toBe(0);
  });
  it('selects the moving arm when the inactive arm stays inside the starting hysteresis band', () => {
    const state = initialPoseState();
    let result;
    // Both limbs have an observed extended start. The left arm then jitters just
    // below the entry endpoint, without crossing its departure threshold.
    const rightAngles = [170, 170, 160, 148, 137, 120, 98, 80, 75, 90, 115, 135, 153, 170];
    for (let index = 0; index < rightAngles.length; index++) {
      const { image } = phoneFrontCurl(rightAngles[index], 'right');
      const leftAngle = index < 2 ? 150 : 142;
      const radians = (leftAngle * Math.PI) / 180;
      image[15] = {
        x: image[13].x + (Math.sin(radians) * 0.1 * 844) / 390,
        y: image[13].y - Math.cos(radians) * 0.1,
        visibility: 0.95,
        presence: 0.95,
      };
      result = analyzePose([image], 'curl', state, 100 + index * 100, 390, 844);
    }
    expect(result!.tracked).toBe(true);
    expect(state.reps).toBe(1);
    expect(state.side).toBe(1);
  });
  it.each(['3d-to-2d', '2d-to-3d'] as const)(
    'counts ten complete automatic curls after a source-matched mixed-arm %s handoff',
    (handoff) => {
      const state = initialPoseState();
      const depthMotion = handoff === '2d-to-3d';
      for (let index = 0; index <= 10 * 48 + 24; index++) {
        const elapsed = Math.max(0, index - 12);
        const angle = elapsed >= 10 * 48 ? 170 : 120 + 50 * Math.cos((elapsed / 48) * Math.PI * 2);
        const { image, world } = phoneFrontCurl(angle, 'right', depthMotion);
        // Different reliable spaces are available for each arm: the active
        // limb must use its own observed start, never the inactive limb's angle.
        world[handoff === '3d-to-2d' ? 14 : 13].visibility = 0.2;
        analyzePose([image], 'curl', state, 100 + (index * 1000) / 24, 390, 844, false, {}, [
          world,
        ]);
      }
      expect(state.side).toBe(1);
      expect(state.geometrySource).toBe(depthMotion ? '3d' : '2d');
      expect(state.reps).toBe(10);
    },
  );
  it.each(['3d-to-2d', '2d-to-3d'] as const)(
    'does not hand off %s to an already-bent arm whose own start was unseen',
    (handoff) => {
      const state = initialPoseState();
      let timestamp = 100;
      const frame = (angle: number) => {
        const { image, world } = phoneFrontCurl(angle, 'right', handoff === '2d-to-3d');
        world[handoff === '3d-to-2d' ? 14 : 13].visibility = 0.2;
        analyzePose([image], 'curl', state, timestamp, 390, 844, false, {}, [world]);
        timestamp += 100;
      };
      for (let index = 0; index < 8; index++) frame(75);
      expect(state.stage).toBe('ready');
      expect(state.side).toBe(0);
      for (const angle of [95, 120, 140, 160, 170, 170]) frame(angle);
      expect(state.reps).toBe(0);
      for (const angle of [170, 155, 135, 110, 85, 75, 75, 95, 120, 140, 160, 170]) frame(angle);
      expect(state.side).toBe(1);
      expect(state.reps).toBe(1);
    },
  );
  it.each(['2d-to-3d', '3d-to-2d'] as const)(
    'requires a new observed start after a ready-state %s geometry change',
    (transition) => {
      const state = initialPoseState();
      let timestamp = 100;
      const frameWithSource = (angle: number, source: '2d' | '3d') => {
        const { image, world } = phoneFrontCurl(angle, 'right', source === '3d');
        const result = analyzePose(
          [image],
          'curl',
          state,
          timestamp,
          390,
          844,
          false,
          { side: 'right' },
          source === '3d' ? [world] : undefined,
        );
        timestamp += 100;
        return result;
      };
      const initial = transition === '2d-to-3d' ? '2d' : '3d';
      const next = initial === '2d' ? '3d' : '2d';
      for (let index = 0; index < 6; index++) frameWithSource(170, initial);
      expect(state.stage).toBe('ready');
      // The new measurement space first sees an already-bent arm. Its lower
      // endpoint cannot inherit the old space's starting evidence.
      for (let index = 0; index < 8; index++) frameWithSource(75, next);
      for (const angle of [95, 120, 140, 160, 170, 170]) frameWithSource(angle, next);
      expect(state.reps).toBe(0);
      expect(state.stage).toBe('ready');
      for (const angle of [155, 135, 110, 85, 75, 75, 95, 120, 140, 160, 170])
        frameWithSource(angle, next);
      expect(state.reps).toBe(1);
    },
  );
  it('counts ten slight-angle phone curls without a global side-on restriction', () => {
    const state = initialPoseState();
    for (let index = 0; index <= 10 * 48 + 12; index++) {
      const { image } = phoneFrontCurl(
        125 + 45 * Math.cos((index / 48) * Math.PI * 2),
        'left',
        false,
        true,
      );
      analyzePose([image], 'curl', state, 100 + (index * 1000) / 24, 390, 844);
    }
    expect(state.reps).toBe(10);
  });
  it('rejects a single implausible wrist jump during an otherwise partial repetition', () => {
    const state = initialPoseState();
    const angles = [
      ...Array(8).fill(170),
      ...Array(40).fill(135),
      70,
      ...Array(6).fill(135),
      ...Array(10).fill(170),
    ] as number[];
    angles.forEach((angle, index) => frame(state, angle, 100 + (index * 1000) / 30));
    expect(state.reps).toBe(0);
    expect(state.lastRepQuality).toBeNull();
  });
  it('rejects a smaller isolated endpoint spike after a long partial bend', () => {
    const state = initialPoseState();
    const angles = [
      ...Array(8).fill(170),
      ...Array(6).fill(150),
      ...Array(6).fill(135),
      ...Array(40).fill(120),
      80,
      ...Array(6).fill(120),
      ...Array(6).fill(135),
      ...Array(6).fill(150),
      ...Array(10).fill(170),
    ] as number[];
    angles.forEach((angle, index) => frame(state, angle, 100 + (index * 1000) / 30));
    expect(state.reps).toBe(0);
  });
  it('honors a shorter coach-approved curl range instead of always enforcing the default range', () => {
    const state = initialPoseState();
    for (let i = 0; i < 40; i++)
      analyzePose(
        [curl(i < 10 || i >= 25 ? 150 : 100)],
        'curl',
        state,
        100 + i * 100,
        W,
        H,
        false,
        { topAngle: 140, bottomAngle: 105 },
      );
    expect(state.reps).toBe(1);
  });
  it('keeps the selected limb when confidence flips on every frame', () => {
    const state = initialPoseState();
    for (let index = 0; index <= 5 * 48 + 12; index++) {
      const pose = curl(125 + 45 * Math.cos((index / 48) * Math.PI * 2));
      const other = curl(170);
      for (const joint of [11, 13, 15, 23]) {
        pose[joint].visibility = index % 2 ? 0.7 : 0.95;
        pose[joint + 1] = { ...other[joint + 1], visibility: index % 2 ? 0.95 : 0.7 };
      }
      frame(state, 0, 100 + (index * 1000) / 24, pose);
      expect(state.side).toBe(0);
    }
    expect(state.reps).toBe(5);
  });
  it('does not count threshold jitter or endpoint oscillations as a rep', () => {
    const state = initialPoseState();
    for (let index = 0; index < 300; index++)
      frame(state, 151 + Math.sin(index * 1.7) * 6, 100 + (index * 1000) / 30);
    expect(state.reps).toBe(0);
    expect(state.stage).toBe('ready');
  });
  it('preserves an observed cycle through a brief occlusion without counting missing time', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    for (let i = 0; i < 6; i++) frame(state, 140 - i * 12, 700 + i * 100);
    const observedBefore = state.observedMs;
    const sideBefore = state.side;
    const missing = analyzePose([], 'curl', state, 1250, W, H);
    expect(missing.tracked).toBe(false);
    expect(state.stage).toBe('working');
    expect(state.side).toBe(sideBefore);
    frame(state, 100, 1400);
    expect(state.observedMs).toBe(observedBefore);
    [120, 140, 160, 170].forEach((angle, i) => frame(state, angle, 1500 + i * 100));
    expect(state.reps).toBe(1);
  });
  it('never completes a rep when the return motion happened entirely out of view', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    for (let i = 0; i < 8; i++) frame(state, 75, 700 + i * 100);
    analyzePose([], 'curl', state, 1450, W, H);
    for (let i = 0; i < 6; i++) frame(state, 170, 1550 + i * 100);
    expect(state.reps).toBe(0);
  });
  it('retains measured return movement through a brief missing frame immediately before extension', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    [140, 128, 116, 104, 92, 80, 100, 120, 140].forEach((angle, i) =>
      frame(state, angle, 700 + i * 100),
    );
    const observedBefore = state.observedMs;
    analyzePose([], 'curl', state, 1550, W, H);
    frame(state, 170, 1600);
    expect(state.reps).toBe(1);
    // The interval across loss is excluded even when earlier return evidence
    // allows a complete observed endpoint to finish the same movement.
    expect(state.observedMs).toBe(observedBefore);
  });
  it('does not reuse return evidence from a completed rep for a later unseen return', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    [140, 128, 116, 104, 92, 80, 100, 120, 140, 170].forEach((angle, i) =>
      frame(state, angle, 700 + i * 100),
    );
    expect(state.reps).toBe(1);
    for (let i = 0; i < 6; i++) frame(state, 170, 1700 + i * 100);
    [140, 128, 116, 104, 92, 80, 75, 75].forEach((angle, i) => frame(state, angle, 2300 + i * 100));
    analyzePose([], 'curl', state, 3050, W, H);
    for (let i = 0; i < 6; i++) frame(state, 170, 3150 + i * 100);
    expect(state.reps).toBe(1);
  });
  it('does not infer a complete unseen curl between two extended observations', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    for (let i = 0; i < 3; i++) analyzePose([], 'curl', state, 650 + i * 100, W, H);
    for (let i = 0; i < 6; i++) frame(state, 170, 900 + i * 100);
    expect(state.reps).toBe(0);
  });
  it('invalidates a pending cycle after sustained occlusion or a camera resolution change', () => {
    for (const resolutionChange of [false, true]) {
      const state = initialPoseState();
      for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
      for (let i = 0; i < 8; i++) frame(state, 75, 700 + i * 100);
      if (!resolutionChange) analyzePose([], 'curl', state, 2000, W, H);
      analyzePose(
        [curl(170)],
        'curl',
        state,
        2200,
        resolutionChange ? 1280 : W,
        resolutionChange ? 720 : H,
      );
      expect(state.reps).toBe(0);
      expect(state.stage).toBe('seek');
    }
  });
  it('invalidates a pending cycle when a different person appears in the camera', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    for (let i = 0; i < 8; i++) frame(state, 75, 700 + i * 100);
    const pose = curl(170).map((point) => ({ ...point, x: point.x - 0.35 }));
    frame(state, 170, 1500, pose);
    expect(state.reps).toBe(0);
    expect(state.stage).toBe('seek');
  });
  it('rejects incomplete, impossibly fast, and stalled movements with an explanation', () => {
    for (const [peak, frameMs, endDelay, reason] of [
      [120, 100, 0, 'range'],
      [60, 100, 16000, 'duration'],
    ] as const) {
      const state = initialPoseState();
      for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
      for (let i = 0; i < 6; i++) frame(state, peak, 700 + i * frameMs);
      if (endDelay) {
        for (let i = 0; i < 165; i++) frame(state, peak, 1300 + i * 100);
        expect(state.reps).toBe(0);
        expect(state.stage).toBe('seek');
      } else {
        for (let i = 0; i < 6; i++) frame(state, 170, 700 + (i + 6) * frameMs);
        expect(state.reps).toBe(0);
        expect(state.rejectionReason).toBe(reason);
      }
    }
  });
  it('rejects a continuously observed but impossibly fast complete curl', () => {
    const state = initialPoseState();
    for (let i = 0; i < 6; i++) frame(state, 170, 100 + i * 100);
    [170, 150, 120, 90, 70, 90, 120, 150, 170, 170].forEach((angle, i) =>
      frame(state, angle, 700 + i * 30),
    );
    expect(state.reps).toBe(0);
    expect(state.rejectionReason).toBe('duration');
  });
  it('provides a stable finite overlay and downgrades minor form errors in completed rep quality', () => {
    const state = initialPoseState();
    let result;
    for (let i = 0; i < 48; i++) {
      const angle = 125 + 45 * Math.cos((i / 40) * Math.PI * 2);
      result = frame(state, angle, 100 + (i * 1000) / 24, curl(angle, 40));
    }
    expect(state.reps).toBe(1);
    expect(state.lastRepQuality).toBeLessThan(85);
    expect(state.lastRepQuality).toBeGreaterThan(50);
    expect(
      result!.filteredLandmarks?.every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      ),
    ).toBe(true);
  });
  it('rejects a wrong curl posture even when elbow movement reaches both endpoints', () => {
    const state = initialPoseState();
    for (let i = 0; i < 60; i++) {
      const angle = 125 + 45 * Math.cos((i / 48) * Math.PI * 2);
      frame(state, angle, 100 + (i * 1000) / 24, curl(angle, 80));
    }
    expect(state.reps).toBe(0);
    expect(state.rejectionReason).toBe('form');
  });
  it('uses trustworthy world geometry and safely falls back from non-finite world landmarks', () => {
    const image = curl(90);
    const world = image.map((point) => ({ x: (point.x * W) / H, y: point.y, z: 0 }));
    const result = analyzePose([image], 'curl', initialPoseState(), 100, W, H, false, {}, [world]);
    expect(result.geometrySource).toBe('3d');
    expect(result.angle).toBe(90);
    world[13].z = NaN;
    world[14].z = NaN;
    const fallback = analyzePose([image], 'curl', initialPoseState(), 100, W, H, false, {}, [
      world,
    ]);
    expect(fallback.geometrySource).toBe('2d');
    expect(fallback.angle).toBe(90);
  });
});

function exercisePose(exercise: ProfileExerciseId, angle: number): Landmark[] {
  const profile = getExerciseProfile(exercise);
  const pose = curl(170);
  for (const side of [0, 1]) {
    const x = 0.45 + side * (profile.view === 'front' ? 0.15 : 0.01);
    const p = (index: number, px: number, py: number) => {
      pose[index + side] = { x: px, y: py, visibility: 0.95, presence: 0.95 };
    };
    const rad = (angle * Math.PI) / 180;
    if (profile.signal === 'knee') {
      p(11, x, 0.2);
      p(23, x, 0.4);
      p(25, x, 0.65);
      p(27, x + (Math.sin(rad) * 0.22 * H) / W, 0.65 - Math.cos(rad) * 0.22);
    } else if (profile.signal === 'shoulder') {
      p(11, x, 0.4);
      p(23, x, 0.7);
      p(13, x + ((side === 0 ? -1 : 1) * Math.sin(rad) * 0.2 * H) / W, 0.4 + Math.cos(rad) * 0.2);
      p(15, x + ((side === 0 ? -1 : 1) * Math.sin(rad) * 0.35 * H) / W, 0.4 + Math.cos(rad) * 0.35);
      if (exercise === 'jumpingjack')
        p(27, angle > 90 ? (side === 0 ? 0.28 : 0.77) : side === 0 ? 0.5 : 0.55, 0.92);
    } else if (profile.signal === 'hip') {
      p(11, 0.2 + side * 0.01, 0.55);
      p(23, 0.45 + side * 0.01, 0.55);
      p(25, 0.45 + side * 0.01 - (Math.cos(rad) * 0.2 * H) / W, 0.55 - Math.sin(rad) * 0.2);
      p(27, 0.7 + side * 0.01, 0.6);
    } else if (profile.signal === 'body') {
      p(11, 0.2 + side * 0.01, 0.5);
      p(23, 0.45 + side * 0.01, 0.5);
      p(27, 0.45 + side * 0.01 - (Math.cos(rad) * 0.3 * H) / W, 0.5 + Math.sin(rad) * 0.3);
    } else if (exercise === 'pushup') {
      p(11, 0.2 + side * 0.01, 0.4);
      p(13, 0.2 + side * 0.01, 0.6);
      p(15, 0.2 + side * 0.01 + (Math.sin(rad) * 0.18 * H) / W, 0.6 - Math.cos(rad) * 0.18);
      p(23, 0.5 + side * 0.01, 0.5);
      p(27, 0.8 + side * 0.01, 0.6);
    } else if (exercise === 'shoulderpress') {
      p(11, x, 0.45);
      p(13, x, 0.3);
      p(15, x + (Math.sin(rad) * 0.18 * H) / W, 0.3 + Math.cos(rad) * 0.18);
      p(23, x, 0.7);
    } else if (exercise === 'row') {
      p(11, 0.3 + side * 0.01, 0.3);
      p(13, 0.3 + side * 0.01, 0.5);
      p(15, 0.3 + side * 0.01 + (Math.sin(rad) * 0.18 * H) / W, 0.5 - Math.cos(rad) * 0.18);
      p(23, 0.6 + side * 0.01, 0.5);
    }
  }
  return pose;
}

describe('exercise-specific profiles', () => {
  it('suspends both-arm depth tracking when the other arm loses valid depth geometry', () => {
    const state = initialPoseState();
    const observe = (angle: number, timestamp: number, uncertain = false) => {
      const image = exercisePose('jumpingjack', angle);
      const world = image.map((point) => ({ ...point, x: (point.x * W) / H, z: 0 }));
      if (uncertain) world[14].visibility = 0.2;
      return analyzePose([image], 'jumpingjack', state, timestamp, W, H, false, {}, [world]);
    };
    observe(15, 100);
    observe(15, 200);
    observe(60, 300);
    expect(state.stage).toBe('working');
    const result = observe(155, 400, true);
    expect(result.tracked).toBe(false);
    expect(result.score).toBeNull();
    expect(state.bottomSeen).toBe(false);
  });
  it.each(['lateralraise', 'jumpingjack'] as const)(
    'requires a front-facing view for %s rather than counting a side-on arm lift',
    (exercise) => {
      const state = initialPoseState();
      let result;
      for (let i = 0; i < 40; i++) {
        const pose = exercisePose(exercise, i < 10 || i >= 25 ? 10 : 155);
        pose[12].x = pose[11].x + 0.01;
        pose[24].x = pose[23].x + 0.01;
        result = analyzePose([pose], exercise, state, 100 + i * 100, W, H);
      }
      expect(state.reps).toBe(0);
      expect(result!.cue).toContain('Face the camera');
    },
  );
  it('does not count a jumping jack when only the arms move and the feet stay closed', () => {
    const state = initialPoseState();
    for (let i = 0; i < 40; i++) {
      const pose = exercisePose('jumpingjack', i < 10 || i >= 25 ? 15 : 155);
      pose[27].x = 0.5;
      pose[28].x = 0.55;
      analyzePose([pose], 'jumpingjack', state, 100 + i * 100, W, H);
    }
    expect(state.reps).toBe(0);
  });
  it.each(['glutebridge', 'crunch'] as const)(
    'does not count a standing hip hinge as %s',
    (exercise) => {
      const state = initialPoseState();
      const profile = getExerciseProfile(exercise);
      for (let i = 0; i < 40; i++) {
        const pose = exercisePose(
          exercise,
          i < 10 || i >= 25
            ? profile.direction === 'increase'
              ? 100
              : 135
            : profile.direction === 'increase'
              ? 170
              : 85,
        );
        for (const side of [0, 1]) {
          pose[11 + side].y -= 0.25;
          pose[23 + side].y -= 0.25;
          pose[25 + side].y -= 0.25;
          pose[27 + side].y = 0.92;
        }
        analyzePose([pose], exercise, state, 100 + i * 100, W, H);
      }
      expect(state.reps).toBe(0);
    },
  );
  it('does not credit a clearly front-supported plank as a side plank', () => {
    const state = initialPoseState();
    for (let i = 0; i <= 20; i++) {
      const pose = exercisePose('sideplank', 175);
      for (const joint of [11, 23, 27]) pose[joint + 1].x = pose[joint].x + 0.18;
      analyzePose([pose], 'sideplank', state, 100 + i * 100, W, H);
    }
    expect(state.holdMs).toBe(0);
  });
  it.each([
    'squat',
    'pushup',
    'lunge',
    'shoulderpress',
    'lateralraise',
    'jumpingjack',
    'glutebridge',
    'crunch',
    'row',
  ] as const)('counts a complete %s using its configured signal and direction', (exercise) => {
    const profile = getExerciseProfile(exercise);
    const start =
      profile.direction === 'decrease' ? profile.topAngle + 10 : profile.bottomAngle - 10;
    const end = profile.direction === 'decrease' ? profile.bottomAngle - 10 : profile.topAngle + 10;
    const state = initialPoseState();
    let result;
    for (let i = 0; i < 40; i++)
      result = analyzePose(
        [exercisePose(exercise, i < 10 || i >= 25 ? start : end)],
        exercise,
        state,
        100 + i * 100,
        W,
        H,
      );
    expect(result!.tracked).toBe(true);
    expect(state.reps).toBe(1);
    expect(state.lastRepQuality).toBeGreaterThan(70);
  });
  it.each(['plank', 'sideplank'] as const)(
    'accumulates only observed aligned %s hold time',
    (exercise) => {
      const state = initialPoseState();
      for (let i = 0; i <= 20; i++)
        analyzePose([exercisePose(exercise, 175)], exercise, state, 100 + i * 100, W, H);
      expect(state.holdMs).toBe(2000);
      analyzePose([], exercise, state, 2200, W, H);
      analyzePose([exercisePose(exercise, 175)], exercise, state, 2300, W, H);
      expect(state.holdMs).toBe(2000);
    },
  );
});
