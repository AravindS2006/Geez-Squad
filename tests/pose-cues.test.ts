import { describe, expect, it } from 'vitest';
import { occlusionCue } from '../src/lib/pose-cues';
import { analyzePose, initialPoseState, type Landmark } from '../src/lib/pose-engine';

const good = (): Landmark[] =>
  Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95, presence: 0.95 }));
const arms = [11, 13, 15];
const legs = [23, 25, 27];

describe('occlusion cue', () => {
  it('asks for framing only when a joint is off-frame', () => {
    const pose = good();
    pose[27].y = 1.2;
    const cue = occlusionCue(pose, legs, false, 0);
    expect(cue).toBe('Step back or recentre so your left ankle is in view.');
    expect(cue).not.toMatch(/hidden|lighting/i);
  });
  it('treats non-finite values as a framing problem', () => {
    const pose = good();
    pose[25].visibility = Number.NaN;
    expect(occlusionCue(pose, legs, false, 0)).toContain('Step back or recentre');
  });
  it('gives lighting advice, not "farther back", for low visibility', () => {
    const pose = good();
    pose[26].visibility = 0.2;
    const cue = occlusionCue(pose, legs, false, 1);
    expect(cue).toBe(
      'Your right knee is unclear. Improve lighting or turn slightly toward the camera.',
    );
    expect(cue).not.toMatch(/back|hidden|recentre/i);
  });
  it('treats low presence the same as low visibility', () => {
    const pose = good();
    pose[15].presence = 0.3;
    expect(occlusionCue(pose, arms, false, 0)).toMatch(/^Your left wrist is unclear\. .*lighting/);
  });
  it('mentions both causes when they are mixed', () => {
    const pose = good();
    pose[27].x = 1.02;
    pose[25].visibility = 0.1;
    const cue = occlusionCue(pose, legs, false, 0);
    expect(cue).toBe(
      'Step back or recentre to fit your left ankle. Improve lighting for your left knee.',
    );
    expect(cue.length).toBeLessThanOrEqual(110);
  });
  it('labels each joint by its own side in bilateral profiles and never swaps', () => {
    const pose = good();
    pose[15].visibility = 0.1; // left wrist, low visibility
    pose[28].y = 1.1; // right ankle, off frame
    const cue = occlusionCue(pose, [11, 13, 15, 23, 25, 27], true, 1);
    expect(cue).toContain('fit your right ankle');
    expect(cue).toContain('lighting for your left wrist');
    expect(cue).not.toContain('right wrist');
    expect(cue).not.toContain('left ankle');
    expect(cue.length).toBeLessThanOrEqual(110);
  });
  it('labels the other side correctly when the used side is the healthy one', () => {
    const pose = good();
    pose[16].visibility = 0.1;
    // The engine would use the left side (side 0); the failing joint is on the right.
    const cue = occlusionCue(pose, arms, true, 0);
    expect(cue).toMatch(/^Your right wrist is unclear/);
    expect(cue).not.toMatch(/left/);
  });
  it('only inspects the used side for single-limb profiles', () => {
    const pose = good();
    pose[16].visibility = 0.1;
    pose[15].visibility = 0.1;
    const cue = occlusionCue(pose, arms, false, 0);
    expect(cue).toContain('left wrist');
    expect(cue).not.toContain('right');
  });
  it('summarises many failing joints briefly', () => {
    const pose = good();
    for (const i of [11, 12, 13, 14, 15, 16]) pose[i].visibility = 0.1;
    expect(occlusionCue(pose, arms, true, 0)).toBe(
      'Your left and right joints are unclear. Improve lighting or turn slightly toward the camera.',
    );
  });
});

describe('engine integration', () => {
  it('reports the real side for a bilateral exercise', () => {
    const pose = good();
    pose[16].visibility = 0.1; // right wrist; engine picks the left side as "used"
    const result = analyzePose([pose], 'jumpingjack', initialPoseState(), 100, 640, 480);
    expect(result.cue).toMatch(/^Your right wrist is unclear/);
    expect(result.cue).not.toMatch(/left/i);
  });
  it('leaves tracking and counting unchanged while a joint is occluded', () => {
    const squat = (angle: number, hidden = false): Landmark[] => {
      const points = good();
      const rad = (angle * Math.PI) / 180;
      for (const side of [0, 1]) {
        const x = 0.5 + side * 0.01;
        points[11 + side] = { x, y: 0.2, visibility: 0.95, presence: 0.95 };
        points[23 + side] = { x, y: 0.4, visibility: 0.95, presence: 0.95 };
        points[25 + side] = { x, y: 0.65, visibility: hidden ? 0.2 : 0.95, presence: 0.95 };
        points[27 + side] = {
          x: x + (Math.sin(rad) * 0.22 * 480) / 640,
          y: 0.65 - Math.cos(rad) * 0.22,
          visibility: 0.95,
          presence: 0.95,
        };
      }
      return points;
    };
    const state = initialPoseState();
    const run = (angle: number, start: number, count: number) => {
      let r;
      for (let i = 0; i < count; i++)
        r = analyzePose([squat(angle)], 'squat', state, start + i * 100, 640, 480);
      return r!;
    };
    run(180, 100, 12);
    run(95, 1300, 12);
    expect(run(180, 2500, 20).reps).toBe(1);
    // Knee confidence 0.2 is below the 0.65 floor: the frame is not tracked,
    // not scored, and the rep count is untouched.
    const occluded = analyzePose([squat(180, true)], 'squat', state, 4600, 640, 480);
    expect(occluded.tracked).toBe(false);
    expect(occluded.score).toBeNull();
    expect(occluded.reps).toBe(1);
    expect(occluded.phase).toBe('position camera');
    expect(occluded.confidence).toBeCloseTo(0.2, 5);
    expect(occluded.cue).toMatch(/^Your left knee is unclear/);
    expect(state.reps).toBe(1);
  });
});
