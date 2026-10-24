import { analyzePose, initialPoseState, type Landmark, type PoseState } from './pose-engine';
import { initialPoseContinuity, validatePoseContinuity } from './pose-continuity';
import { initialJointStability, stabilizePoseJoints } from './pose-joints';
import type { DiagnosticFrame } from './pose-diagnostics';
import type { RepEvent } from './rep-events';

const landmarks = (poses: DiagnosticFrame['poses']): Landmark[][] =>
  poses.map((p) =>
    p.map((v) => ({
      x: v.x ?? NaN,
      y: v.y ?? NaN,
      z: v.z ?? undefined,
      visibility: v.visibility ?? 0,
      presence: v.presence ?? 0,
    })),
  );
/** Re-run raw observations; drawing/smoothing output is never fed to measurement. */
export function replayPoseReport(report: { frames: DiagnosticFrame[] }) {
  if (!Array.isArray(report.frames) || report.frames.length > 100000)
    throw new Error('Invalid or oversized tracking report.');
  let state = initialPoseState(),
    preview = initialPoseState(),
    wasActive = false;
  const continuity = initialPoseContinuity(),
    joints = initialJointStability();
  const events: RepEvent[] = [],
    frames: {
      timestamp: number;
      reps: number;
      tracked: boolean;
      cue: string;
      rejectedJoints: number;
    }[] = [];
  const seed = (p: PoseState): PoseState => ({
    ...structuredClone(p),
    reps: 0,
    holdMs: 0,
    lastEvent: undefined,
    armTotals: undefined,
    coordinator: undefined,
    ...(p.limbs ? { limbs: { left: seed(p.limbs.left), right: seed(p.limbs.right) } } : {}),
  });
  for (const frame of report.frames) {
    const active = frame.mode === 'active';
    if (active && !wasActive) state = seed(preview);
    const observed = validatePoseContinuity(
      continuity,
      landmarks(frame.poses),
      frame.worldPoses.length ? landmarks(frame.worldPoses) : undefined,
      frame.timestamp,
      frame.width,
      frame.height,
    );
    if (observed.resetRequired) {
      state = {
        ...initialPoseState(),
        reps: state.reps,
        holdMs: state.holdMs,
        armTotals: state.armTotals,
      };
      preview = initialPoseState();
    }
    const stable = stabilizePoseJoints(
      joints,
      observed.poses,
      observed.worldPoses,
      frame.timestamp,
      frame.width,
      frame.height,
    );
    const result = analyzePose(
      stable.poses,
      frame.exercise,
      active ? state : preview,
      frame.timestamp,
      frame.width,
      frame.height,
      false,
      frame.config,
      stable.worldPoses,
    );
    if (active) events.push(...(result.repEvents ?? []));
    frames.push({
      timestamp: frame.timestamp,
      reps: result.reps,
      tracked: result.tracked,
      cue: result.cue,
      rejectedJoints: stable.rejectedJoints,
    });
    wasActive = active;
  }
  return { reps: state.reps, holdMs: state.holdMs, arms: state.armTotals, events, frames };
}
export function matchRepEvents(
  detected: { endedAt: number; side?: string }[],
  truth: { endedAt: number; side?: string }[],
  toleranceMs = 750,
) {
  const used = new Set<number>();
  let matched = 0;
  for (const event of detected) {
    let best = -1,
      distance = Infinity;
    truth.forEach((annotation, i) => {
      const d = Math.abs(annotation.endedAt - event.endedAt);
      if (
        !used.has(i) &&
        (!annotation.side || annotation.side === event.side) &&
        d <= toleranceMs &&
        d < distance
      ) {
        best = i;
        distance = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return {
    truePositives: matched,
    falsePositives: detected.length - matched,
    falseNegatives: truth.length - matched,
    precision: detected.length ? matched / detected.length : truth.length ? 0 : 1,
    recall: truth.length ? matched / truth.length : 1,
  };
}
