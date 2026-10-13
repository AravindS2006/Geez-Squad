import { describe, expect, it } from 'vitest';
import { initialPoseContinuity, validatePoseContinuity } from '../src/lib/pose-continuity';
import { analyzePose, initialPoseState, type Landmark } from '../src/lib/pose-engine';

const W = 720,
  H = 1280;
function pose(): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
    presence: 0.95,
  }));
  for (const [index, x, y] of [
    [11, 0.65, 0.25],
    [12, 0.35, 0.25],
    [23, 0.61, 0.55],
    [24, 0.39, 0.55],
    [13, 0.65, 0.43],
    [14, 0.35, 0.43],
    [15, 0.65, 0.63],
    [16, 0.35, 0.63],
  ])
    points[index] = { ...points[index], x, y };
  return points;
}
const world = (points: Landmark[]) =>
  points.map((point) => ({ ...point, x: point.x - 0.5, y: point.y - 0.55, z: 0 }));
function swap(points: Landmark[], pairs = [11, 23]) {
  const result = structuredClone(points);
  for (const index of pairs)
    [result[index], result[index + 1]] = [result[index + 1], result[index]];
  return result;
}
const observe = (
  state: ReturnType<typeof initialPoseContinuity>,
  points: Landmark[],
  timestamp: number,
  worldPoints?: Landmark[],
) =>
  validatePoseContinuity(state, [points], worldPoints ? [worldPoints] : undefined, timestamp, W, H);

describe('anatomical landmark continuity', () => {
  it('preserves ten complete curls through isolated shoulder and hip identity errors without synthesizing movement', () => {
    const continuity = initialPoseContinuity(),
      movement = initialPoseState();
    let rejected = 0;
    for (let frame = 0; frame <= 10 * 48 + 12; frame++) {
      const points = pose();
      const angle = 120 + 50 * Math.cos((frame / 48) * Math.PI * 2);
      const radians = (angle * Math.PI) / 180;
      for (const side of [0, 1]) {
        const shoulder = points[11 + side];
        const elbow = { ...shoulder, y: 0.43 };
        points[13 + side] = elbow;
        points[15 + side] = {
          ...elbow,
          x: elbow.x + ((side === 0 ? 1 : -1) * Math.sin(radians) * 0.18 * H) / W,
          y: elbow.y - Math.cos(radians) * 0.18,
        };
      }
      const faulty = frame % 48 === 11 || frame % 48 === 37;
      const input = faulty ? swap(points, frame % 48 === 11 ? [11] : [23]) : points;
      const current = observe(continuity, input, 100 + (frame * 1000) / 24);
      expect(current.resetRequired).toBe(false);
      if (current.rejected) rejected++;
      analyzePose(
        current.poses,
        'curl',
        movement,
        100 + (frame * 1000) / 24,
        W,
        H,
        false,
        { side: 'left' },
        current.worldPoses,
      );
    }
    expect(rejected).toBe(21);
    expect(movement.reps).toBe(10);
  });
  it.each([{ pairs: [11, 23] }, { pairs: [11] }, { pairs: [23] }])(
    'rejects abrupt torso pair inversion $pairs in both outputs without rewriting any point',
    ({ pairs }) => {
      const state = initialPoseContinuity(),
        points = pose();
      const first = observe(state, points, 0, world(points));
      expect(first.rejected).toBe(false);
      const inverted = swap(points, pairs),
        rawWorld = world(inverted);
      const snapshot = structuredClone({ inverted, rawWorld });
      const result = observe(state, inverted, 33, rawWorld);
      expect(result.rejected).toBe(true);
      expect(result.reason).toBe('landmark-identity');
      expect(result.poses).toEqual([]);
      expect(result.worldPoses).toEqual([]);
      expect(result.rawPoses[0]).toBe(inverted);
      expect(result.rawWorldPoses?.[0]).toBe(rawWorld);
      expect({ inverted, rawWorld }).toEqual(snapshot);
      expect(observe(state, points, 66, world(points)).rejected).toBe(false);
    },
  );

  it('rejects contradictory world labels even when image labels are unchanged', () => {
    const state = initialPoseContinuity(),
      points = pose(),
      measuredWorld = world(points);
    observe(state, points, 0, measuredWorld);
    const result = observe(state, points, 33, swap(measuredWorld));
    expect(result.rejected).toBe(true);
    expect(result.poses).toEqual([]);
    expect(result.worldPoses).toEqual([]);
  });

  it('reacquires a sustained stable observed orientation only after multiple frames and invalidates the pending cycle', () => {
    const state = initialPoseContinuity(),
      points = pose(),
      inverted = swap(points);
    observe(state, points, 0);
    for (const timestamp of [33, 66, 99, 132])
      expect(observe(state, inverted, timestamp).rejected).toBe(true);
    const result = observe(state, inverted, 165);
    expect(result.rejected).toBe(false);
    expect(result.resetRequired).toBe(true);
    expect(result.reason).toBe('landmark-identity');
    expect(result.poses[0]).toBe(inverted);
    expect(observe(state, inverted, 198).resetRequired).toBe(false);
  });

  it('does not infer a stable new identity from oscillating candidates', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    for (let frame = 1; frame < 15; frame++) {
      const moved = swap(points);
      moved[11].y += frame % 2 ? 0.1 : 0;
      const result = observe(state, moved, frame * 33);
      expect(result.rejected).toBe(true);
      expect(result.resetRequired).toBe(false);
    }
  });

  it('accepts a genuine gradual turn through a narrow shoulder view', () => {
    const state = initialPoseContinuity(),
      points = pose();
    for (let frame = 0; frame < 16; frame++) {
      const current = structuredClone(points);
      const rotation = (frame / 15) * Math.PI;
      for (const [index, span] of [
        [11, 0.15],
        [23, 0.11],
      ]) {
        current[index].x = 0.5 + span * Math.cos(rotation);
        current[index + 1].x = 0.5 - span * Math.cos(rotation);
      }
      expect(observe(state, current, frame * 50).rejected).toBe(false);
    }
  });

  it('does not sort or swap wrists when arms cross in an ordinary curl', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    for (let frame = 1; frame < 20; frame++) {
      const current = structuredClone(points);
      current[15].x = 0.65 - frame * 0.015;
      current[16].x = 0.35 + frame * 0.015;
      current[15].y = current[16].y = 0.25 + frame * 0.01;
      const result = observe(state, current, frame * 33);
      expect(result.rejected).toBe(false);
      expect(result.poses[0]).toBe(current);
      expect(result.poses[0][15]).toBe(current[15]);
      expect(result.poses[0][16]).toBe(current[16]);
    }
  });

  it('keeps identity through valid slower camera frames inside the engine observation grace', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    for (const timestamp of [300, 600, 900]) {
      const result = observe(state, points, timestamp);
      expect(result.rejected).toBe(false);
      expect(result.resetRequired).toBe(false);
    }
  });

  it('accepts either initial anatomical orientation and does not impose screen-side labels', () => {
    const points = swap(pose());
    const state = initialPoseContinuity();
    expect(observe(state, points, 0).rejected).toBe(false);
    expect(observe(state, points, 33).rejected).toBe(false);
  });

  it('does not treat narrow overlapping torso points as a reliable inversion', () => {
    const state = initialPoseContinuity(),
      points = pose();
    for (const index of [11, 23]) {
      points[index].x = 0.505;
      points[index + 1].x = 0.495;
    }
    observe(state, points, 0);
    expect(observe(state, swap(points), 33).rejected).toBe(false);
  });

  it('uses only a short-lived association reference through torso occlusion without raising current confidence', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    const hidden = structuredClone(points);
    hidden[11].visibility = 0.1;
    const result = observe(state, hidden, 33);
    expect(result.rejected).toBe(false);
    expect(result.poses[0][11].visibility).toBe(0.1);
    expect(state.previous).not.toBeNull();
    expect(observe(state, swap(points), 66).rejected).toBe(true);
    expect(observe(state, points, 99).rejected).toBe(false);
  });

  it.each([NaN, Infinity])(
    'never treats invalid joint confidence %s as identity evidence',
    (confidence) => {
      const state = initialPoseContinuity(),
        points = pose();
      points[11].visibility = confidence;
      observe(state, points, 0);
      expect(state.previous).toBeNull();
    },
  );

  it('reports a new camera view for a relocated person instead of remapping left and right', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    const moved = points.map((point) => ({ ...point, y: point.y + 0.3 }));
    expect(observe(state, moved, 33).rejected).toBe(true);
    expect(observe(state, moved, 99).rejected).toBe(true);
    const result = observe(state, moved, 165);
    expect(result.rejected).toBe(false);
    expect(result.resetRequired).toBe(true);
    expect(result.reason).toBe('view-change');
    expect(result.poses[0]).toBe(moved);
  });

  it('rejects a single body relocation and immediately accepts the original body on recovery', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    const outlier = points.map((point) => ({ ...point, y: point.y + 0.3 }));
    expect(observe(state, outlier, 33).poses).toEqual([]);
    const recovered = observe(state, points, 66);
    expect(recovered.rejected).toBe(false);
    expect(recovered.resetRequired).toBe(false);
    expect(recovered.poses[0]).toBe(points);
  });

  it.each(['gap', 'resolution'] as const)(
    'reacquires rather than bridges a %s change',
    (change) => {
      const state = initialPoseContinuity(),
        points = pose();
      observe(state, points, 0);
      const inverted = swap(points);
      const result = validatePoseContinuity(
        state,
        [inverted],
        undefined,
        change === 'gap' ? 500 : 33,
        change === 'resolution' ? 1280 : W,
        change === 'resolution' ? 720 : H,
      );
      expect(result.rejected).toBe(false);
      expect(result.resetRequired).toBe(true);
      expect(result.reason).toBe('view-change');
    },
  );

  it('never retains a previous skeleton after actual person loss', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    const missing = validatePoseContinuity(state, [], [], 33, W, H);
    expect(missing.poses).toEqual([]);
    const returning = observe(state, swap(points), 66);
    expect(returning.rejected).toBe(true);
    expect(returning.poses).toEqual([]);
  });

  it('discards identity association after prolonged occlusion even when missing frames keep arriving', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    for (const timestamp of [33, 200, 350, 500]) {
      expect(validatePoseContinuity(state, [], [], timestamp, W, H).poses).toEqual([]);
    }
    expect(state.previous).toBeNull();
    const result = observe(state, swap(points), 533);
    expect(result.rejected).toBe(false);
  });

  it('does not bridge an ambiguous multiple-person observation', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 0);
    validatePoseContinuity(state, [points, points], undefined, 33, W, H);
    expect(state.previous).toBeNull();
    expect(observe(state, swap(points), 66).rejected).toBe(false);
  });

  it('ignores duplicate timestamps without erasing the last reliable identity', () => {
    const state = initialPoseContinuity(),
      points = pose();
    observe(state, points, 100);
    const previous = state.previous;
    expect(observe(state, points, 100)).toMatchObject({ rejected: true, resetRequired: false });
    expect(state.previous).toBe(previous);
    expect(observe(state, points, 150).rejected).toBe(false);
  });
  it.each([NaN, Infinity, -1])(
    'rejects a stale or invalid timestamp %s consistently',
    (timestamp) => {
      const state = initialPoseContinuity(),
        points = pose();
      observe(state, points, 0, world(points));
      const result = observe(state, points, timestamp, world(points));
      expect(result.rejected).toBe(true);
      expect(result.resetRequired).toBe(true);
      expect(result.reason).toBe('invalid-frame');
      expect(result.poses).toEqual([]);
      expect(result.worldPoses).toEqual([]);
    },
  );
});
