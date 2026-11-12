/**
 * Synthetic regression replay for the profile-v10 and profile-v11 counting defaults.
 *
 * Every trace below is generated in memory from angle waypoints: no clip, video or
 * recorded landmarks are involved, and nothing here feeds `pose:evaluate` or the release
 * gates. These are synthetic engine inputs that lock in what the counting rules do with a
 * given angle path on each pose model. They are NOT accuracy or release evidence.
 *
 * Unlike tests/pose-engine-v3.test.ts, the traces run through `replayPoseReport`, so they
 * also pass continuity validation, joint stabilization, the preview-to-active seed and the
 * per-frame `model`.
 */
import { describe, expect, it } from 'vitest';
import { RULE_VERSION } from '../src/lib/pose-engine';
import { replayPoseReport } from '../src/lib/pose-replay';
import type { DiagnosticFrame } from '../src/lib/pose-diagnostics';
import type { ArmMode } from '../src/lib/exercise-library';
import { normalizeWorkoutConfig } from '../src/lib/workout-config';

const W = 640,
  H = 480,
  FRAME_MS = 100,
  MODELS = ['heavy', 'full', 'lite'] as const;
type Model = (typeof MODELS)[number];
type Exercise = 'curl' | 'shoulderpress' | 'lateralraise';
type Point = DiagnosticFrame['poses'][number][number];

/** One ramp-and-hold segment per waypoint: 5 degrees per frame, then `hold` frames still. */
function segments(waypoints: number[], hold = 8): number[][] {
  let current = waypoints[0];
  return waypoints.map((target) => {
    const angles: number[] = [];
    while (Math.abs(target - current) > 5) {
      current += Math.sign(target - current) * 5;
      angles.push(current);
    }
    current = target;
    for (let i = 0; i < hold; i++) angles.push(target);
    return angles;
  });
}
const path = (waypoints: number[]) => segments(waypoints).flat();

/** 33 landmarks with each arm at its own angle; geometry mirrors pose-engine-v3 builders. */
function pose(exercise: Exercise, left: number, right: number): Point[] {
  const points: Point[] = Array.from({ length: 33 }, () => point(0.5, 0.5));
  for (const side of [0, 1]) {
    const angle = side === 0 ? left : right;
    const rad = (angle * Math.PI) / 180;
    const set = (index: number, x: number, y: number) => (points[index + side] = point(x, y));
    if (exercise === 'curl') {
      // Side-on arm: upper arm hangs straight down, forearm opens by the elbow angle.
      const x = 0.5 + side * 0.01;
      set(11, x, 0.2);
      set(13, x, 0.42);
      set(15, x + (Math.sin(rad) * 0.18 * H) / W, 0.42 - Math.cos(rad) * 0.18);
      set(23, x, 0.65);
      set(25, x, 0.77);
      set(27, x, 0.92);
    } else if (exercise === 'lateralraise') {
      // Front view: the arm opens away from the trunk by the shoulder angle.
      const x = 0.45 + side * 0.15,
        out = side === 0 ? -1 : 1;
      set(11, x, 0.4);
      set(23, x, 0.7);
      set(13, x + (out * Math.sin(rad) * 0.2 * H) / W, 0.4 + Math.cos(rad) * 0.2);
      set(15, x + (out * Math.sin(rad) * 0.35 * H) / W, 0.4 + Math.cos(rad) * 0.35);
      set(25, x, 0.8);
      set(27, x, 0.92);
    } else {
      // Shoulder press: upper arm points up from the shoulder, forearm opens by the elbow angle.
      const x = 0.45 + side * 0.01;
      set(11, x, 0.45);
      set(13, x, 0.3);
      set(15, x + (Math.sin(rad) * 0.18 * H) / W, 0.3 + Math.cos(rad) * 0.18);
      set(23, x, 0.7);
      set(25, x, 0.8);
      set(27, x, 0.92);
    }
  }
  return points;
}
function point(x: number, y: number): Point {
  return { x, y, z: 0, visibility: 0.95, presence: 0.95 };
}

type Trace = {
  exercise: Exercise;
  model: Model;
  left: number[];
  right?: number[];
  armMode?: ArmMode;
  /** Preview frames before the active set, replayed as `mode: 'preview'`. */
  preview?: number[];
  /** Drop `frames` frames after active frame index `at` (timestamps keep advancing). */
  gap?: { at: number; frames: number };
};
function trace({ exercise, model, left, right = left, armMode, preview = [], gap }: Trace) {
  expect(right.length).toBe(left.length);
  // Record the normalized default config the way recordPoseDiagnostics does. The angles are
  // the untouched profile defaults, so Full and Lite still narrow them per frame.model.
  const normalized = normalizeWorkoutConfig(exercise, armMode ? { armMode } : {});
  const config: DiagnosticFrame['config'] = {
    side: normalized.side,
    topAngle: normalized.topAngle,
    bottomAngle: normalized.bottomAngle,
    minRepMs: normalized.minRepMs,
    ...(normalized.armMode ? { armMode: normalized.armMode } : {}),
  };
  const frames: DiagnosticFrame[] = [];
  let timestamp = 100;
  const push = (mode: 'preview' | 'active', l: number, r: number) => {
    frames.push({
      timestamp,
      exercise,
      config,
      width: W,
      height: H,
      model,
      backend: 'synthetic',
      inferenceMs: null,
      mode,
      stage: '',
      continuity: '',
      analysis: {
        tracked: true,
        reps: 0,
        angle: null,
        confidence: 0,
        score: null,
        phase: '',
        cue: '',
        geometrySource: null,
        trackedSide: null,
        rejectionReason: null,
      },
      poses: [pose(exercise, l, r)],
      // No world landmarks: every row here measures on-screen geometry.
      worldPoses: [],
    });
    timestamp += FRAME_MS;
  };
  for (const angle of preview) push('preview', angle, angle);
  left.forEach((angle, index) => {
    push('active', angle, right[index]);
    if (gap && index === gap.at) timestamp += gap.frames * FRAME_MS;
  });
  return frames;
}

function replay(input: Trace) {
  const frames = trace(input);
  const report = replayPoseReport({ frames });
  // Preview frames analyze a separate state; the active set starts from zero and preview
  // evidence never reaches the active count or the event list.
  const previewCount = input.preview?.length ?? 0;
  const counts = report.frames.slice(previewCount).map((f) => f.reps);
  expect(counts[0]).toBe(0);
  // Automatic counts are monotonic.
  counts.forEach((reps, i) => expect(reps).toBeGreaterThanOrEqual(i ? counts[i - 1] : 0));
  expect(counts.at(-1)).toBe(report.reps);
  const activeStart = frames[previewCount].timestamp;
  expect(report.events.every((event) => event.endedAt >= activeStart)).toBe(true);
  return report;
}

const both = (waypoints: number[]) => ({ left: path(waypoints) });
/**
 * Both arms move together; only the bottom waypoint differs per arm. The arm with the
 * shorter ramp holds each waypoint longer so the segments stay aligned frame for frame.
 */
function asymmetric(top: number, left: number, right: number, end: number) {
  const l = segments([top, left, end]),
    r = segments([top, right, end]);
  const pad = (a: number[], b: number[]) => [...a, ...Array(b.length - a.length).fill(a.at(-1))];
  return {
    left: l.flatMap((s, i) => (s.length < r[i].length ? pad(s, r[i]) : s)),
    right: r.flatMap((s, i) => (s.length < l[i].length ? pad(s, l[i]) : s)),
  };
}

describe('synthetic regression replay (synthetic engine inputs, not accuracy or release evidence)', () => {
  it('is pinned to profile-v11 (synthetic table, not evidence)', () => {
    // A rule bump must re-derive every row below on purpose, not just update this string.
    expect(
      RULE_VERSION,
      'RULE_VERSION changed: re-derive the synthetic regression table in tests/pose-regression.test.ts deliberately before updating this pin.',
    ).toBe('profile-v11');
  });

  // profile-v10 single-profile rows. Same angle on both arms, no limb modes.
  describe.each(MODELS)('profile-v10 defaults on %s (synthetic, not evidence)', (model) => {
    it.each([
      // Lateral raise arms at <= 28 (start), top 80, minimum range 45: 23 -> 90 is a full rep.
      ['lateralraise', [23, 90, 23], 1],
      // 23 -> 50 never reaches the 80-degree top or the 45-degree range.
      ['lateralraise', [23, 50, 23], 0],
      // Press starts <= 95, top 140, minimum range 45: 70 -> 145 locks out.
      ['shoulderpress', [70, 145, 70], 1],
      // 70 -> 130 stops short of the 140-degree top.
      ['shoulderpress', [70, 130, 70], 0],
    ] as const)('%s through %j counts %i', (exercise, waypoints, reps) => {
      const report = replay({ exercise, model, ...both([...waypoints]) });
      expect(report.reps).toBe(reps);
      expect(report.events).toHaveLength(reps);
    });
  });

  // profile-v11 curl rows. Full/Lite default endpoints narrow from 145/85 to 135/91; a rep
  // needs start >= top, end <= bottom + 6, return >= top - 6 and range >= the minimum.
  const curls = {
    // Full: start 136 >= 135, ends 88 and 94 <= 97, return 143 >= 129, range >= 38.
    full: asymmetric(136, 88, 94, 143),
    // Lite: start 143 >= 135, ends 96 and 87 <= 97, return 146 >= 129.
    lite: asymmetric(143, 96, 87, 146),
    // Heavy: start 150 >= 145, ends 76 and 86 <= 91, return 159 >= 139, so every model counts.
    heavy: asymmetric(150, 76, 86, 159),
  };
  const modes: ArmMode[] = ['both', 'left', 'right'];
  const expected: [keyof typeof curls, Model, number][] = [
    ['full', 'full', 1],
    // Heavy keeps 145/85: the 136-degree start never arms the rep.
    ['full', 'heavy', 0],
    ['lite', 'lite', 1],
    ['heavy', 'heavy', 1],
    ['heavy', 'full', 1],
    ['heavy', 'lite', 1],
  ];
  describe.each(modes)('profile-v11 curl, %s arm mode (synthetic, not evidence)', (armMode) => {
    it.each(expected)('%s-model trace replayed on %s counts %i', (name, model, reps) => {
      const report = replay({ exercise: 'curl', model, armMode, ...curls[name] });
      expect(report.reps).toBe(reps);
      // Both arms run their own cycle in every mode, so each arm records its own rep.
      expect(report.arms?.left.reps).toBe(reps);
      expect(report.arms?.right.reps).toBe(reps);
      expect(report.events).toHaveLength(reps * 2);
    });
    it.each([
      // Return 125 stays below the 129-degree Full return threshold.
      [[136, 88, 125]],
      // Flexion stops at 100, above the 97-degree Full end threshold.
      [[136, 100, 143]],
    ])('partial Full curl through %j counts 0', (waypoints) => {
      const report = replay({ exercise: 'curl', model: 'full', armMode, ...both(waypoints) });
      expect(report.reps).toBe(0);
      expect(report.arms?.left.reps).toBe(0);
      expect(report.arms?.right.reps).toBe(0);
      expect(report.events).toHaveLength(0);
    });
  });

  describe('preview frames and dropped-frame gaps (synthetic, not evidence)', () => {
    it('a full curl seen only in preview adds no reps or events', () => {
      const preview = path([150, 80, 155, 150]);
      const report = replay({
        exercise: 'curl',
        model: 'heavy',
        armMode: 'both',
        preview,
        left: path([150]),
      });
      // The preview state did see a complete rep; none of it reaches the active set.
      expect(report.frames[preview.length - 1].reps).toBe(1);
      expect(report.reps).toBe(0);
      expect(report.events).toHaveLength(0);
    });
    it('a preview lead-in then an active rep counts only the active rep', () => {
      const report = replay({
        exercise: 'curl',
        model: 'full',
        armMode: 'both',
        preview: path([136, 88, 143]),
        ...curls.full,
      });
      expect(report.reps).toBe(1);
      expect(report.events).toHaveLength(2);
    });
    it.each(MODELS)('a brief gap in a held position keeps the count on %s', (model) => {
      const report = replay({
        exercise: 'shoulderpress',
        model,
        left: path([70, 145, 70]),
        gap: { at: 4, frames: 2 },
      });
      expect(report.reps).toBe(1);
      expect(report.events).toHaveLength(1);
    });
    it('a sustained gap over the bottom does not supply the missing bottom', () => {
      const left = path([136, 88, 143]);
      // Drop every frame at or below the 97-degree Full end threshold (about 1.1 s, longer
      // than the 450 ms continuity grace), so the bend is never observed.
      const kept = left.filter((angle) => angle > 97);
      const report = replay({
        exercise: 'curl',
        model: 'full',
        armMode: 'both',
        left: kept,
        gap: { at: left.findIndex((angle) => angle <= 97) - 1, frames: left.length - kept.length },
      });
      expect(report.reps).toBe(0);
      expect(report.events).toHaveLength(0);
    });
  });
});
