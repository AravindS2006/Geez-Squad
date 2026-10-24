import type { Analysis, Landmark, PoseState } from './pose-engine';
import type { ExerciseId } from './types';
import type { WorkoutConfig } from './workout-config';

type DiagnosticConfig = Pick<
  WorkoutConfig,
  'side' | 'topAngle' | 'bottomAngle' | 'minRepMs' | 'calibrationSource' | 'armMode'
>;

type DiagnosticPoint = {
  x: number | null;
  y: number | null;
  z: number | null;
  visibility: number | null;
  presence: number | null;
};
export type DiagnosticFrame = {
  mediaTimeMs?: number;
  timestamp: number;
  exercise: ExerciseId;
  config: DiagnosticConfig;
  width: number;
  height: number;
  model: string;
  backend: string;
  inferenceMs: number | null;
  mode: string;
  stage: string;
  continuity: string;
  rejectedJoints?: number;
  limbStates?: Record<
    string,
    {
      stage: string;
      bottomSeen: boolean;
      returnSeen: boolean;
      observedMs: number;
      source: string | null;
    }
  >;
  analysis: {
    tracked: boolean;
    reps: number;
    angle: number | null;
    confidence: number;
    score: number | null;
    phase: string;
    cue: string;
    geometrySource: string | null;
    trackedSide: string | null;
    rejectionReason: string | null;
    arms?: Analysis['arms'];
    repEvents?: Analysis['repEvents'];
    technique?: Analysis['technique'];
  };
  poses: DiagnosticPoint[][];
  worldPoses: DiagnosticPoint[][];
};

export type PoseDiagnosticBuffer = { frames: DiagnosticFrame[]; lastTimestamp: number | null };
export const initialPoseDiagnostics = (): PoseDiagnosticBuffer => ({
  frames: [],
  lastTimestamp: null,
});
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100000) / 100000 : null;
const points = (poses: Landmark[][] | undefined): DiagnosticPoint[][] =>
  (poses ?? []).slice(0, 2).map((pose) =>
    pose.slice(0, 33).map((point) => ({
      x: number(point?.x),
      y: number(point?.y),
      z: number(point?.z),
      visibility: number(point?.visibility),
      presence: number(point?.presence),
    })),
  );

/** Opt-in, local-only measurements. Never retain image bitmaps, audio, or account data. */
export function recordPoseDiagnostics(
  buffer: PoseDiagnosticBuffer,
  input: {
    timestamp: number;
    mediaTimeMs?: number;
    exercise: ExerciseId;
    config: DiagnosticConfig;
    width: number;
    height: number;
    model: string;
    backend: string;
    inferenceMs: number;
    mode: string;
    stage: string;
    continuity: string;
    analysis: Analysis;
    poses: Landmark[][];
    worldPoses?: Landmark[][];
    state?: PoseState;
    rejectedJoints?: number;
  },
): void {
  if (!Number.isFinite(input.timestamp) || input.timestamp < 0) return;
  if (buffer.lastTimestamp !== null && input.timestamp <= buffer.lastTimestamp) return;
  buffer.lastTimestamp = input.timestamp;
  const result = input.analysis;
  buffer.frames.push({
    timestamp: input.timestamp,
    ...(Number.isFinite(input.mediaTimeMs) ? { mediaTimeMs: input.mediaTimeMs } : {}),
    exercise: input.exercise,
    config: {
      side: input.config.side,
      topAngle: input.config.topAngle,
      bottomAngle: input.config.bottomAngle,
      minRepMs: input.config.minRepMs,
      ...(input.config.armMode ? { armMode: input.config.armMode } : {}),
      ...(input.config.calibrationSource
        ? { calibrationSource: input.config.calibrationSource }
        : {}),
    },
    width: input.width,
    height: input.height,
    model: input.model,
    backend: input.backend,
    inferenceMs: number(input.inferenceMs),
    mode: input.mode,
    stage: input.stage,
    continuity: input.continuity,
    rejectedJoints: input.rejectedJoints,
    ...(input.state
      ? {
          limbStates: Object.fromEntries(
            Object.entries(input.state.limbs ?? { selected: input.state }).map(([side, s]) => [
              side,
              {
                stage: s.stage,
                bottomSeen: s.bottomSeen,
                returnSeen: s.returnMovementSeen,
                observedMs: s.observedMs,
                source: s.geometrySource,
              },
            ]),
          ),
        }
      : {}),
    analysis: {
      tracked: result.tracked,
      reps: result.reps,
      angle: number(result.angle),
      confidence: result.confidence,
      score: number(result.score),
      phase: result.phase,
      cue: result.cue,
      geometrySource: result.geometrySource ?? null,
      trackedSide: result.trackedSide ?? null,
      rejectionReason: result.rejectionReason ?? null,
      ...(result.arms ? { arms: structuredClone(result.arms) } : {}),
      ...(result.repEvents ? { repEvents: result.repEvents, technique: result.technique } : {}),
    },
    poses: points(input.poses),
    worldPoses: points(input.worldPoses),
  });
  // Retain every analyzed frame: downsampling erased short extrema while the
  // state still said "working", making missed-rep reports impossible to inspect.
  // Bound memory to 600 frames or a minute (about 30 seconds at 20 analyzed FPS).
  while (buffer.frames.length > 600 || input.timestamp - buffer.frames[0].timestamp > 60000)
    buffer.frames.shift();
}

export function poseDiagnosticReport(
  buffer: PoseDiagnosticBuffer,
  metadata: { userAgent: string; ruleVersion: string },
) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    userAgent: metadata.userAgent,
    ruleVersion: metadata.ruleVersion,
    runtime: '@mediapipe/tasks-vision@0.10.32',
    contents: 'Joint coordinates and counter states; no camera images, audio, or account data.',
    frameCount: buffer.frames.length,
    durationMs:
      buffer.frames.length > 1
        ? Math.round(buffer.frames.at(-1)!.timestamp - buffer.frames[0].timestamp)
        : 0,
    frames: buffer.frames,
  };
}
