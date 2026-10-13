import { describe, expect, it } from 'vitest';
import {
  initialPoseDiagnostics,
  poseDiagnosticReport,
  recordPoseDiagnostics,
} from '../src/lib/pose-diagnostics';
import type { Analysis, Landmark } from '../src/lib/pose-engine';

const pose: Landmark[] = Array.from({ length: 33 }, () => ({
  x: 0.123456789,
  y: 0.5,
  z: NaN,
  visibility: 0.95,
  presence: 0.9,
}));
const analysis: Analysis = {
  tracked: false,
  reps: 2,
  holdSeconds: 0,
  score: null,
  confidence: 0.7,
  angle: null,
  phase: 'position camera',
  cue: 'Keep your working wrist visible.',
  ruleVersion: 'test',
  trackedSide: 'right',
};
const input = {
  timestamp: 0,
  exercise: 'curl' as const,
  config: { side: 'auto' as const, topAngle: 145, bottomAngle: 75, minRepMs: 550 },
  width: 720,
  height: 1280,
  model: 'full',
  backend: 'CPU',
  inferenceMs: 55,
  mode: 'active',
  stage: 'working',
  continuity: 'landmark-identity',
  analysis,
  poses: [pose],
  worldPoses: [pose],
};

describe('opt-in tracking diagnostics', () => {
  it('keeps a brief endpoint even without a counter or phase transition', () => {
    const buffer = initialPoseDiagnostics();
    for (const [timestamp, angle] of [
      [100, 100],
      [150, 80],
      [200, 100],
    ])
      recordPoseDiagnostics(buffer, { ...input, timestamp, analysis: { ...analysis, angle } });
    expect(buffer.frames.map((frame) => frame.analysis.angle)).toEqual([100, 80, 100]);
  });
  it('keeps at most a minute and 600 samples regardless of camera FPS', () => {
    const buffer = initialPoseDiagnostics();
    for (let time = 0; time < 120000; time += 10)
      recordPoseDiagnostics(buffer, { ...input, timestamp: time });
    expect(buffer.frames).toHaveLength(600);
    expect(buffer.frames.at(-1)!.timestamp - buffer.frames[0].timestamp).toBe(5990);
    expect(buffer.frames[0].timestamp).toBeGreaterThanOrEqual(60000);
  });

  it('snapshots raw joints, preserves rejection evidence, and serializes no unrelated fields', () => {
    const buffer = initialPoseDiagnostics();
    const measurements = structuredClone(pose);
    recordPoseDiagnostics(buffer, {
      ...input,
      poses: [measurements],
      bitmap: 'CAMERA_IMAGE_DO_NOT_EXPORT',
      cookie: 'PRIVATE_ACCOUNT_DO_NOT_EXPORT',
      config: { ...input.config, loadKg: 15, account: 'PRIVATE_ACCOUNT_DO_NOT_EXPORT' },
    } as typeof input);
    measurements[0].x = 0.9;
    const report = poseDiagnosticReport(buffer, { userAgent: 'Test browser', ruleVersion: 'test' });
    expect(report.frames[0].poses[0][0].x).toBe(0.12346);
    expect(report.frames[0].poses[0][0].z).toBeNull();
    expect(report.frames[0].continuity).toBe('landmark-identity');
    expect(report.frames[0].analysis.cue).toBe(analysis.cue);
    expect(report.frames[0].config).toEqual(input.config);
    expect(JSON.stringify(report)).not.toMatch(/CAMERA_IMAGE|PRIVATE_ACCOUNT|cookie|bitmap/);
  });

  it('does not admit stale timestamps and caps malformed pose sizes', () => {
    const buffer = initialPoseDiagnostics();
    recordPoseDiagnostics(buffer, { ...input, timestamp: 100 });
    for (const time of [99, NaN, -1, Infinity])
      recordPoseDiagnostics(buffer, { ...input, timestamp: time });
    expect(buffer.frames).toHaveLength(1);
    recordPoseDiagnostics(buffer, {
      ...input,
      timestamp: 500,
      poses: [Array(100).fill(pose[0]), pose, pose],
    });
    expect(buffer.frames[1].poses).toHaveLength(2);
    expect(buffer.frames[1].poses[0]).toHaveLength(33);
  });

  it('retains short identity faults and rep transitions between regular samples', () => {
    const buffer = initialPoseDiagnostics();
    recordPoseDiagnostics(buffer, { ...input, continuity: 'accepted', timestamp: 100 });
    recordPoseDiagnostics(buffer, { ...input, timestamp: 133 });
    recordPoseDiagnostics(buffer, { ...input, continuity: 'accepted', timestamp: 166 });
    recordPoseDiagnostics(buffer, {
      ...input,
      continuity: 'accepted',
      timestamp: 199,
      analysis: { ...analysis, reps: 3 },
    });
    expect(buffer.frames.map((frame) => frame.timestamp)).toEqual([100, 133, 166, 199]);
    recordPoseDiagnostics(buffer, {
      ...input,
      continuity: 'accepted',
      stage: 'ready',
      timestamp: 232,
      analysis: { ...analysis, reps: 3, rejectionReason: 'range' },
    });
    expect(buffer.frames.at(-1)!.timestamp).toBe(232);
    expect(buffer.frames.at(-1)!.analysis.rejectionReason).toBe('range');
  });
});
