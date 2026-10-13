import { jointAngle, type Point } from './pose-geometry';
import { analyzePoseForm } from './pose-form';
export { jointAngle } from './pose-geometry';
import type { ExerciseId } from './types';
import { getExerciseProfile, type ExerciseProfile } from './exercise-profiles';
import { defaultWorkoutConfig, normalizeWorkoutConfig, type WorkoutConfig } from './workout-config';

export const RULE_VERSION = 'profile-v7';
export type Landmark = { x: number; y: number; z?: number; visibility?: number; presence?: number };
export type Analysis = {
  reps: number;
  holdSeconds: number;
  score: number | null;
  confidence: number;
  phase: string;
  cue: string;
  angle: number | null;
  tracked: boolean;
  postureValid?: boolean;
  ruleVersion: string;
  rangeDegrees?: number;
  lastRepSeconds?: number;
  lastRepQuality?: number | null;
  rejectionReason?: string | null;
  geometrySource?: '2d' | '3d';
  trackedSide?: 'left' | 'right';
  filteredLandmarks?: Landmark[];
  trackingCoverage?: number | null;
  rejectedReps?: number;
};

type Filter = { raw: number; value: number; velocity: number; timestamp: number };

type Identity = { x: number; y: number; torso: number; width: number; height: number };
export type PoseState = {
  reps: number;
  holdMs: number;
  stage: 'seek' | 'ready' | 'working';
  candidate: string;
  candidateSince: number;
  startedAt: number;
  lastTimestamp: number;
  smoothAngle: number | null;
  side: number | null;
  lastRepAt: number;
  cycleMin: number;
  cycleMax: number;
  lastRange: number;
  lastDuration: number;
  previousHoldValid: boolean;
  bottomSeen: boolean;
  feedbackUntil: number;
  feedback: string;
  exercise: ExerciseId | null;
  filters: Record<string, Filter>;
  identity: Identity | null;
  missingSince: number | null;
  lastObservedAt: number;
  observedMs: number;
  returnEvidenceRequired: boolean;
  returnMovementSeen: boolean;
  cycleFormTotal: number;
  cycleConfidenceTotal: number;
  cycleSamples: number;
  cycleFormValid: boolean;
  cycleInvalidMs: number;
  previousFormValid: boolean;
  lastRepQuality: number | null;
  rejectionReason: string | null;
  geometrySource: '2d' | '3d' | null;
  sideStartSeen: [number, number];
  sideWorldSegments: [number[] | null, number[] | null];
  lastRawSignal: number | null;
  rawVelocity: number;
  sideStartSource: ['2d' | '3d' | null, '2d' | '3d' | null];
  formReference: Point | null;
};

export function initialPoseState(): PoseState {
  return {
    reps: 0,
    holdMs: 0,
    stage: 'seek',
    candidate: '',
    candidateSince: 0,
    startedAt: 0,
    lastTimestamp: 0,
    smoothAngle: null,
    side: null,
    lastRepAt: -10000,
    cycleMin: 180,
    cycleMax: 0,
    lastRange: 0,
    lastDuration: 0,
    previousHoldValid: false,
    bottomSeen: false,
    feedbackUntil: 0,
    feedback: '',
    exercise: null,
    filters: {},
    identity: null,
    missingSince: null,
    lastObservedAt: 0,
    observedMs: 0,
    returnEvidenceRequired: false,
    returnMovementSeen: false,
    cycleFormTotal: 0,
    cycleConfidenceTotal: 0,
    cycleSamples: 0,
    cycleFormValid: true,
    cycleInvalidMs: 0,
    previousFormValid: true,
    lastRepQuality: null,
    rejectionReason: null,
    geometrySource: null,
    sideStartSeen: [-10000, -10000],
    sideWorldSegments: [null, null],
    lastRawSignal: null,
    rawVelocity: 0,
    sideStartSource: [null, null],
    formReference: null,
  };
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

// One Euro filtering raises the cutoff during movement, avoiding the fixed-filter
// lag that previously erased short curl endpoints. Values are never extrapolated.
function filterValue(
  state: PoseState,
  key: string,
  raw: number,
  timestamp: number,
  beta = 10,
): number {
  const previous = state.filters[key];
  const dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
  if (!previous || dt <= 0 || dt > 0.75) {
    state.filters[key] = { raw, value: raw, velocity: 0, timestamp };
    return raw;
  }
  const velocity =
    previous.velocity + alpha(1, dt) * ((raw - previous.raw) / dt - previous.velocity);
  const value =
    previous.value + alpha(1.5 + beta * Math.abs(velocity), dt) * (raw - previous.value);
  state.filters[key] = { raw, value, velocity, timestamp };
  return value;
}

function resetCycle(state: PoseState, releaseSide = false) {
  state.stage = 'seek';
  state.candidate = '';
  state.smoothAngle = null;
  state.bottomSeen = false;
  state.observedMs = 0;
  state.returnEvidenceRequired = false;
  state.returnMovementSeen = false;
  state.previousHoldValid = false;
  state.filters = {};
  state.geometrySource = null;
  state.sideWorldSegments = [null, null];
  state.lastRawSignal = null;
  state.rawVelocity = 0;
  state.formReference = null;
  if (releaseSide) {
    state.side = null;
    state.identity = null;
    state.sideStartSeen = [-10000, -10000];
    state.sideStartSource = [null, null];
  }
}

function unavailable(state: PoseState, cue: string, confidence = 0): Analysis {
  return {
    reps: state.reps,
    holdSeconds: Math.floor(state.holdMs / 1000),
    score: null,
    confidence,
    phase: 'position camera',
    cue,
    angle: null,
    tracked: false,
    ruleVersion: RULE_VERSION,
    rangeDegrees: state.lastRange,
    lastRepSeconds: state.lastDuration,
    lastRepQuality: state.lastRepQuality,
    rejectionReason: state.rejectionReason,
  };
}

function suspend(
  state: PoseState,
  timestamp: number,
  cue: string,
  graceMs: number,
  confidence = 0,
): Analysis {
  state.previousHoldValid = false;
  state.missingSince ??= timestamp;
  if (state.stage === 'working' && !state.returnMovementSeen) state.returnEvidenceRequired = true;
  if (!state.lastTimestamp || timestamp - state.lastTimestamp > graceMs) resetCycle(state, true);
  return unavailable(state, cue, confidence);
}

const jointNames: Record<number, string> = {
  11: 'shoulder',
  13: 'elbow',
  15: 'wrist',
  23: 'hip',
  25: 'knee',
  27: 'ankle',
  29: 'heel',
  31: 'foot',
};

function confidenceOf(point: Landmark | undefined): number {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0.01 ||
    point.x > 0.99 ||
    point.y < 0.01 ||
    point.y > 0.99 ||
    !Number.isFinite(point.visibility) ||
    !Number.isFinite(point.presence ?? 1)
  )
    return 0;
  return Math.max(0, Math.min(1, point.visibility ?? 0, point.presence ?? 1));
}

function limbSignal(signal: string, point: (index: number) => Point): number | null {
  if (signal === 'knee') return jointAngle(point(23), point(25), point(27));
  if (signal === 'elbow') return jointAngle(point(11), point(13), point(15));
  if (signal === 'shoulder') return jointAngle(point(23), point(11), point(13));
  if (signal === 'hip') return jointAngle(point(11), point(23), point(25));
  return jointAngle(point(11), point(23), point(27));
}

function signalJoints(signal: string): [number, number, number] {
  return signal === 'knee'
    ? [23, 25, 27]
    : signal === 'elbow'
      ? [11, 13, 15]
      : signal === 'shoulder'
        ? [23, 11, 13]
        : signal === 'hip'
          ? [11, 23, 25]
          : [11, 23, 27];
}

function worldGeometry(
  pose: Landmark[],
  world: Landmark[] | undefined,
  side: number,
  profile: ExerciseProfile,
  width: number,
  height: number,
  previousLengths: number[] | null,
): { angle: number; lengths: number[] } | null {
  if (
    !world ||
    !profile.joints.every((index) => {
      const point = world[index + side];
      return (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.z) &&
        (point.visibility === undefined || point.visibility >= 0.65) &&
        (point.presence === undefined || point.presence >= 0.65) &&
        Math.abs(point.x) < 3 &&
        Math.abs(point.y) < 3 &&
        Math.abs(point.z!) < 3
      );
    })
  )
    return null;
  const torso = Math.hypot(
    world[11 + side].x - world[23 + side].x,
    world[11 + side].y - world[23 + side].y,
    world[11 + side].z! - world[23 + side].z!,
  );
  if (torso <= 0.08 || torso >= 1) return null;
  const triangle = signalJoints(profile.signal);
  const lengths = triangle.slice(0, 2).map((index, segment) => {
    const a = world[index + side],
      b = world[triangle[segment + 1] + side];
    return Math.hypot(a.x - b.x, a.y - b.y, a.z! - b.z!);
  });
  if (
    !lengths.every(
      (length, index) =>
        length > 0.025 &&
        length < 1.5 &&
        (!previousLengths ||
          (length / previousLengths[index] >= 0.65 && length / previousLengths[index] <= 1.5)),
    )
  )
    return null;
  if (
    profile.view === 'side' &&
    !triangle.slice(0, 2).every((index, segment) => {
      const a = world[index + side],
        b = world[triangle[segment + 1] + side];
      const ia = pose[index + side],
        ib = pose[triangle[segment + 1] + side];
      const dx = (ia.x - ib.x) * width,
        dy = (ia.y - ib.y) * height;
      const projectedLength = Math.hypot(a.x - b.x, a.y - b.y);
      const imageLength = Math.hypot(dx, dy);
      return (
        imageLength < 1 ||
        projectedLength / lengths[segment] < 0.65 ||
        (dx * (a.x - b.x) + dy * (a.y - b.y)) / imageLength / projectedLength >= 0.2
      );
    })
  )
    return null;
  const angle = limbSignal(profile.signal, (index) => world[index + side]);
  return angle === null ? null : { angle, lengths };
}

function reject(state: PoseState, reason: string, cue: string, timestamp: number) {
  state.feedbackUntil = timestamp + 1800;
  state.feedback = cue;
  state.rejectionReason = reason;
}

export function analyzePose(
  poses: Landmark[][],
  exercise: ExerciseId,
  state: PoseState,
  timestamp: number,
  width: number,
  height: number,
  paused = false,
  settings: Partial<WorkoutConfig> = defaultWorkoutConfig(exercise),
  worldLandmarks?: Landmark[][],
): Analysis {
  const profile = getExerciseProfile(exercise);
  const config = normalizeWorkoutConfig(exercise, settings);
  // A duplicated/out-of-order delivery is not evidence of a new body or a
  // tracking loss. Ignore it without destroying an observed in-flight cycle.
  if (
    !paused &&
    Number.isFinite(timestamp) &&
    state.lastTimestamp &&
    timestamp <= state.lastTimestamp
  )
    return unavailable(state, 'Waiting for a fresh camera frame.');
  if (paused || !Number.isFinite(timestamp) || timestamp < 0) {
    resetCycle(state, true);
    state.lastTimestamp = 0;
    return unavailable(
      state,
      paused ? 'Tracking paused. Resume when you are ready.' : 'Waiting for a fresh camera frame.',
    );
  }
  if (state.exercise && state.exercise !== exercise) resetCycle(state, true);
  state.exercise = exercise;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    poses.length !== 1 ||
    poses[0].length < 33
  ) {
    if (poses.length > 1) resetCycle(state, true);
    return suspend(
      state,
      timestamp,
      poses.length > 1
        ? 'One person at a time. Clear the camera view.'
        : 'Step back until your head and required joints fit in view. Use even lighting.',
      profile.occlusionGraceMs,
    );
  }
  const pose = poses[0];
  const confidenceFor = (side: number) =>
    Math.min(...profile.joints.map((index) => confidenceOf(pose[index + side])));
  const left = confidenceFor(0),
    right = confidenceFor(1);
  const selectedSide = config.side === 'left' ? 0 : config.side === 'right' ? 1 : null;
  let side = selectedSide ?? state.side ?? (left >= right ? 0 : 1);
  const startEndpoint = profile.direction === 'decrease' ? config.topAngle : config.bottomAngle;
  const inputWorld = worldLandmarks?.length === 1 ? worldLandmarks[0] : undefined;
  const sideWorld = [0, 1].map((limb) =>
    config.calibrationSource === '2d'
      ? null
      : worldGeometry(
          pose,
          inputWorld,
          limb,
          profile,
          width,
          height,
          state.sideWorldSegments[limb],
        ),
  );
  const sideSignals = [0, 1].map(
    (limb) =>
      sideWorld[limb]?.angle ??
      limbSignal(profile.signal, (index) => ({
        x: (pose[index + limb]?.x ?? NaN) * width,
        y: (pose[index + limb]?.y ?? NaN) * height,
      })),
  );
  for (const limb of [0, 1]) {
    const angle = sideSignals[limb];
    if (
      (limb === 0 ? left : right) >= 0.65 &&
      angle !== null &&
      (profile.direction === 'decrease' ? angle >= startEndpoint : angle <= startEndpoint)
    ) {
      state.sideStartSeen[limb] = timestamp;
      state.sideStartSource[limb] = sideWorld[limb] ? '3d' : '2d';
    }
  }
  // Front-facing single-arm work can begin on either side. Choose the moving
  // limb while still at the start, then keep that identity for the entire cycle.
  if (
    selectedSide === null &&
    !profile.bilateral &&
    state.stage === 'ready' &&
    profile.view !== 'side'
  ) {
    const current = sideSignals[side],
      other = sideSignals[1 - side];
    // Readiness survives small endpoint jitter inside the hysteresis band. Use
    // that same band for handoff, or an inactive arm at 142° can indefinitely
    // prevent choosing the other arm even though it has an observed start.
    const currentAtStart =
      current !== null &&
      (profile.direction === 'decrease'
        ? current >= startEndpoint - profile.hysteresis
        : current <= startEndpoint + profile.hysteresis);
    const otherMoving =
      other !== null &&
      (profile.direction === 'decrease'
        ? other < startEndpoint - profile.hysteresis
        : other > startEndpoint + profile.hysteresis);
    if (
      currentAtStart &&
      otherMoving &&
      (side === 0 ? right : left) >= 0.65 &&
      state.sideStartSource[1 - side] === (sideWorld[1 - side] ? '3d' : '2d') &&
      timestamp - state.sideStartSeen[1 - side] <= 750
    ) {
      side = 1 - side;
      state.side = side;
      state.filters = {};
      state.smoothAngle = null;
      state.lastRawSignal = null;
      state.rawVelocity = 0;
      // This limb has its own recent, source-matched start evidence above.
      // Its geometry lock must not inherit the inactive limb's measurement
      // space; same-limb source changes still require reacquisition below.
      state.geometrySource = null;
      state.formReference = null;
    }
  }
  const confidence = profile.bilateral ? Math.min(left, right) : side === 0 ? left : right;
  if (state.side !== null && selectedSide !== null && side !== state.side) {
    resetCycle(state, true);
    return unavailable(
      state,
      'Working side changed. Return to your starting position.',
      confidence,
    );
  }
  // Layer 2: an occluded limb stays selected during a cycle. The other limb is
  // never spliced into its movement just because its confidence becomes higher.
  if (confidence < 0.65) {
    const hidden = profile.joints
      .filter(
        (index) =>
          confidenceOf(pose[index + side]) < 0.65 ||
          (profile.bilateral && confidenceOf(pose[index + 1 - side]) < 0.65),
      )
      .map((index) => jointNames[index] ?? 'body joint');
    return suspend(
      state,
      timestamp,
      `Keep your ${hidden.join(', ')} visible. Improve lighting or move the camera farther back.`,
      profile.occlusionGraceMs,
      confidence,
    );
  }
  const rawPoint = (index: number): Point => ({
    x: (pose[index + side]?.x ?? NaN) * width,
    y: (pose[index + side]?.y ?? NaN) * height,
  });
  const shoulder = rawPoint(11),
    hip = rawPoint(23);
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (!Number.isFinite(torso) || torso < height * 0.04)
    return suspend(
      state,
      timestamp,
      'Move closer so your body landmarks are clear.',
      profile.occlusionGraceMs,
      confidence,
    );
  const bothTorsoVisible = [11, 12, 23, 24].every((index) => confidenceOf(pose[index]) >= 0.65);
  const identity = {
    x: bothTorsoVisible
      ? [11, 12, 23, 24].reduce((total, index) => total + pose[index].x, 0) / 4
      : (shoulder.x + hip.x) / 2 / width,
    y: bothTorsoVisible
      ? [11, 12, 23, 24].reduce((total, index) => total + pose[index].y, 0) / 4
      : (shoulder.y + hip.y) / 2 / height,
    torso: torso / height,
    width,
    height,
  };
  const previousIdentity = state.identity;
  if (
    previousIdentity &&
    (width !== previousIdentity.width ||
      height !== previousIdentity.height ||
      Math.hypot(
        ((identity.x - previousIdentity.x) * width) / height,
        identity.y - previousIdentity.y,
      ) > Math.max(identity.torso, previousIdentity.torso) ||
      torso / height / previousIdentity.torso > 1.8 ||
      torso / height / previousIdentity.torso < 0.55)
  ) {
    resetCycle(state, true);
    state.lastTimestamp = timestamp;
    return unavailable(state, 'Camera view changed. Return to your starting position.', confidence);
  }
  const gap = state.lastTimestamp ? timestamp - state.lastTimestamp : 0;
  const returningFromLoss = state.missingSince !== null;
  if (gap > profile.occlusionGraceMs) resetCycle(state, false);
  if (returningFromLoss) state.filters = {};
  state.missingSince = null;
  state.identity = identity;
  state.side = side;
  const shoulderWidth = Math.hypot(
    (pose[11].x - pose[12].x) * width,
    (pose[11].y - pose[12].y) * height,
  );
  if (
    profile.view === 'side' &&
    confidenceOf(pose[11]) > 0.3 &&
    confidenceOf(pose[12]) > 0.3 &&
    shoulderWidth / torso > 0.75
  ) {
    resetCycle(state, false);
    return unavailable(state, 'Turn side-on to the camera for this exercise.', confidence);
  }
  if (
    profile.view === 'front' &&
    (![11, 12, 23, 24].every((index) => confidenceOf(pose[index]) >= 0.65) ||
      shoulderWidth / torso < 0.35)
  ) {
    resetCycle(state, false);
    return unavailable(
      state,
      'Face the camera and keep both shoulders and hips visible for this exercise.',
      confidence,
    );
  }
  // Layers 1, 3 and 4: finite landmarks, adaptive smoothing, then geometry in
  // camera pixels. Normalized x/y alone would distort mobile portrait angles.
  const filtered = pose.map((point, index) =>
    confidenceOf(point) > 0
      ? {
          ...point,
          x: filterValue(state, `${index}:x`, point.x, timestamp),
          y: filterValue(state, `${index}:y`, point.y, timestamp),
        }
      : { ...point, visibility: 0 },
  );
  const imagePoint = (index: number): Point => ({
    x: (filtered[index + side]?.x ?? NaN) * width,
    y: (filtered[index + side]?.y ?? NaN) * height,
  });
  // A bilateral cycle uses one coordinate space for both limbs. Losing the
  // opposite limb's depth must not silently substitute its projected angle.
  const trustworthyWorld = !profile.bilateral || sideWorld.every(Boolean) ? sideWorld[side] : null;
  if (config.calibrationSource === '3d' && !trustworthyWorld)
    return suspend(
      state,
      timestamp,
      'Your calibrated depth view is unavailable. Restore the camera view or calibrate again.',
      profile.occlusionGraceMs,
      confidence,
    );
  let source: '3d' | '2d' = trustworthyWorld ? '3d' : '2d';
  if (state.stage === 'working' && state.geometrySource === '3d' && !trustworthyWorld)
    return suspend(
      state,
      timestamp,
      'Depth tracking is uncertain. Keep your working joints visible.',
      profile.occlusionGraceMs,
      confidence,
    );
  if (state.stage === 'working' && state.geometrySource === '2d') source = '2d';
  if (source !== state.geometrySource) {
    // Entry evidence belongs to its measurement space. A newly available depth
    // estimate, or a fallback to image geometry, must observe its own start
    // before it can complete a cycle. Completed repetitions remain intact.
    if (state.geometrySource !== null) resetCycle(state, false);
    delete state.filters.angle;
    state.smoothAngle = null;
    state.lastRawSignal = null;
  }
  state.geometrySource = source;
  for (const limb of [0, 1])
    if (sideWorld[limb]) state.sideWorldSegments[limb] = sideWorld[limb]!.lengths;
  const rawSignal =
    source === '3d' ? trustworthyWorld!.angle : limbSignal(profile.signal, rawPoint);
  if (rawSignal === null)
    return suspend(
      state,
      timestamp,
      'Reposition the camera; joint geometry is unclear.',
      profile.occlusionGraceMs,
      confidence,
    );
  if (
    state.lastRawSignal !== null &&
    gap > 0 &&
    gap <= profile.occlusionGraceMs &&
    (Math.abs(rawSignal - state.lastRawSignal) / gap) * 1000 > 1500
  )
    return suspend(
      state,
      timestamp,
      'A joint moved unexpectedly in the camera. Hold your position while tracking settles.',
      profile.occlusionGraceMs,
      confidence,
    );
  const rawVelocity =
    state.lastRawSignal === null || !gap || returningFromLoss
      ? 0
      : ((rawSignal - state.lastRawSignal) / gap) * 1000;
  state.lastRawSignal = rawSignal;
  // Native MediaPipe VIDEO tracking already filters landmarks. Independently
  // filter the movement signal once rather than cascading two low-pass delays.
  const angle = filterValue(state, 'angle', rawSignal, timestamp, 0.08);
  state.smoothAngle = angle;
  const formPoint = source === '3d' ? (index: number) => inputWorld![index + side] : imagePoint;
  if (profile.form === 'curl' && !state.formReference) {
    const shoulder = formPoint(11),
      hip = formPoint(23);
    state.formReference = {
      x: shoulder.x - hip.x,
      y: shoulder.y - hip.y,
      z: (shoulder.z ?? 0) - (hip.z ?? 0),
    };
  }
  const form = analyzePoseForm(profile.form, imagePoint, formPoint, state.formReference);
  if (!form.valid && form.score !== null) form.score = Math.min(form.score, 60);
  if (form.score !== null && form.valid)
    form.score = clamp(filterValue(state, 'formScore', form.score, timestamp, 0.03));
  if (
    profile.form === 'sideplank' &&
    confidenceOf(pose[11]) >= 0.65 &&
    confidenceOf(pose[12]) >= 0.65 &&
    shoulderWidth > torso * 0.18
  ) {
    const dx = Math.abs((filtered[11].x - filtered[12].x) * width);
    const dy = Math.abs((filtered[11].y - filtered[12].y) * height);
    if (dy < dx * 0.65) {
      form.valid = false;
      form.score = Math.min(form.score ?? 60, 60);
      form.cue =
        'Turn onto your supporting side and stack your shoulders. Ask your coach to verify the side plank.';
    }
  }
  if (
    (profile.form === 'pushup' || profile.isHold) &&
    !form.valid &&
    Math.abs(imagePoint(27).y - imagePoint(11).y) >
      Math.abs(imagePoint(27).x - imagePoint(11).x) * 1.43
  ) {
    resetCycle(state, false);
    return unavailable(state, form.cue ?? profile.startCue, confidence);
  }
  if (profile.isHold) {
    if (profile.form === 'plank' || profile.form === 'sideplank') {
      const ankle = imagePoint(27);
      const slope = Math.abs(
        (Math.atan2(ankle.y - imagePoint(11).y, ankle.x - imagePoint(11).x) * 180) / Math.PI,
      );
      if (Math.min(slope, 180 - slope) >= 45) {
        resetCycle(state, false);
        return unavailable(state, 'Move into a side-on plank position.', confidence);
      }
    }
    const holding = angle >= config.topAngle && form.valid;
    if (
      holding &&
      state.previousHoldValid &&
      !returningFromLoss &&
      gap > 0 &&
      gap <= profile.occlusionGraceMs
    )
      state.holdMs += gap;
    state.previousHoldValid = holding;
    state.lastTimestamp = timestamp;
    state.lastObservedAt = timestamp;
    return {
      reps: state.reps,
      holdSeconds: Math.floor(state.holdMs / 1000),
      score: form.score,
      confidence,
      phase: holding ? 'holding' : 'adjusting',
      cue: form.cue ?? (holding ? 'Hold steady and breathe comfortably.' : profile.startCue),
      angle: Math.round(angle),
      tracked: true,
      postureValid: form.valid,
      ruleVersion: RULE_VERSION,
      geometrySource: source,
      trackedSide: side === 0 ? 'left' : 'right',
      filteredLandmarks: filtered,
      lastRepQuality: state.lastRepQuality,
    };
  }
  // Layers 5–8: each profile declares its signal and direction. Separate enter
  // and leave thresholds prevent jitter at the extended position from rearming.
  const decreasing = profile.direction === 'decrease';
  const startAngle = decreasing ? config.topAngle : config.bottomAngle;
  const endAngle = decreasing ? config.bottomAngle : config.topAngle;
  const otherImagePoint = (index: number): Point => ({
    x: (filtered[index + 1 - side]?.x ?? NaN) * width,
    y: (filtered[index + 1 - side]?.y ?? NaN) * height,
  });
  const otherAngle = profile.bilateral
    ? source === '3d' && sideWorld[1 - side]
      ? filterValue(state, 'otherAngle', sideWorld[1 - side]!.angle, timestamp, 0.08)
      : limbSignal(profile.signal, otherImagePoint)
    : angle;
  const ankleWidth = Math.abs(imagePoint(27).x - otherImagePoint(27).x);
  const shoulderSpan = Math.max(1, Math.abs(imagePoint(11).x - otherImagePoint(11).x));
  const feetClosed = profile.form !== 'jumpingjack' || ankleWidth <= shoulderSpan * 1.1;
  const feetOpen = profile.form !== 'jumpingjack' || ankleWidth >= shoulderSpan * 1.25;
  const startTolerance = state.stage !== 'seek' ? profile.hysteresis : 0;
  const atStart =
    (decreasing
      ? angle >= startAngle - startTolerance &&
        (!profile.bilateral || (otherAngle !== null && otherAngle >= startAngle - startTolerance))
      : angle <= startAngle + startTolerance &&
        (!profile.bilateral ||
          (otherAngle !== null && otherAngle <= startAngle + startTolerance))) && feetClosed;
  const awayFromStart = decreasing
    ? angle < startAngle - profile.hysteresis
    : angle > startAngle + profile.hysteresis;
  const atEnd =
    (decreasing
      ? rawSignal <= endAngle + profile.hysteresis && angle <= endAngle + profile.hysteresis
      : rawSignal >= endAngle - profile.hysteresis && angle >= endAngle - profile.hysteresis) &&
    (!profile.bilateral ||
      (otherAngle !== null &&
        (decreasing
          ? otherAngle <= endAngle + profile.hysteresis
          : otherAngle >= endAngle - profile.hysteresis))) &&
    feetOpen &&
    (profile.form !== 'press' || imagePoint(15).y < imagePoint(11).y - torso * 0.35);
  const candidate = atStart ? 'top' : atEnd ? 'bottom' : 'moving';
  const previousCandidate = state.candidate;
  if (candidate !== state.candidate) {
    state.candidate = candidate;
    state.candidateSince = timestamp;
  }
  if (state.stage === 'seek' && atStart && timestamp - state.candidateSince >= 60)
    state.stage = 'ready';
  if (state.stage === 'ready' && awayFromStart) {
    state.stage = 'working';
    state.startedAt = timestamp;
    state.observedMs = 0;
    state.cycleMin = Math.min(startAngle, rawSignal);
    state.cycleMax = Math.max(startAngle, rawSignal);
    state.bottomSeen = false;
    state.cycleFormTotal = 0;
    state.cycleConfidenceTotal = 0;
    state.cycleSamples = 0;
    state.cycleFormValid = true;
    state.cycleInvalidMs = 0;
    state.previousFormValid = form.valid;
    state.returnEvidenceRequired = false;
    state.returnMovementSeen = false;
  }
  if (state.stage === 'working') {
    if (!returningFromLoss && gap > 0 && gap <= profile.occlusionGraceMs) state.observedMs += gap;
    state.cycleMin = Math.min(state.cycleMin, rawSignal);
    state.cycleMax = Math.max(state.cycleMax, rawSignal);
    const observedInterval =
      !returningFromLoss && gap > 0 && gap <= profile.occlusionGraceMs ? gap : 0;
    if (form.score !== null) {
      state.cycleFormTotal += form.score * observedInterval;
      state.cycleSamples += observedInterval;
    }
    state.cycleConfidenceTotal += confidence * observedInterval;
    // Brief landmark noise must not invalidate a whole cycle. Both adjacent
    // observations must show bad alignment before that interval counts as bad.
    if (
      !returningFromLoss &&
      gap > 0 &&
      gap <= profile.occlusionGraceMs &&
      !form.valid &&
      !state.previousFormValid
    )
      state.cycleInvalidMs += gap;
    state.previousFormValid = form.valid;
    state.cycleFormValid = !(
      state.cycleInvalidMs >= 150 && state.cycleInvalidMs / Math.max(1, state.observedMs) >= 0.2
    );
    const observedApproach = decreasing
      ? rawVelocity < -5 && state.rawVelocity < -5
      : rawVelocity > 5 && state.rawVelocity > 5;
    // One endpoint frame is enough when it continues an observed, plausible
    // approach. A lone joint spike after a stationary partial movement is not.
    if (
      atEnd &&
      (previousCandidate === 'bottom' || (observedApproach && Math.abs(rawVelocity) <= 1000))
    )
      state.bottomSeen = true;
    // A measured return interval remains evidence after a later brief gap.
    // Requiring another midpoint after every missing frame erased valid returns
    // whenever a rejected identity frame fell immediately before the start.
    // Only actual progress away from the observed endpoint supplies evidence;
    // a lost bottom followed directly by the start still cannot complete a rep.
    if (
      state.bottomSeen &&
      candidate === 'moving' &&
      !returningFromLoss &&
      gap > 0 &&
      gap <= profile.occlusionGraceMs &&
      (decreasing
        ? rawVelocity > 5 && rawSignal > state.cycleMin + profile.hysteresis
        : rawVelocity < -5 && rawSignal < state.cycleMax - profile.hysteresis)
    )
      state.returnMovementSeen = true;
    if (returningFromLoss && state.bottomSeen && !state.returnMovementSeen)
      state.returnEvidenceRequired = true;
    if (state.returnEvidenceRequired && state.returnMovementSeen)
      state.returnEvidenceRequired = false;
    if (timestamp - state.startedAt > profile.maxRepMs) {
      reject(
        state,
        'duration',
        'Rep not counted. Return to the start and make one continuous controlled movement.',
        timestamp,
      );
      resetCycle(state, false);
    } else if (atStart) {
      const range = state.cycleMax - state.cycleMin;
      const requiredRange = Math.max(
        15,
        Math.min(
          profile.minimumRom,
          Math.abs(config.topAngle - config.bottomAngle) - profile.hysteresis,
        ),
      );
      // Layers 9–11: count only observed movement, acceptable alignment and a
      // completed excursion. Missing camera intervals never increase duration.
      if (!state.bottomSeen || range < requiredRange || state.returnEvidenceRequired)
        reject(
          state,
          'range',
          'Rep not counted. Complete your coach-approved range and return to the start. Adjust the range with your coach if needed.',
          timestamp,
        );
      else if (state.observedMs < config.minRepMs)
        reject(
          state,
          'duration',
          'Rep not counted. Move more slowly and under control.',
          timestamp,
        );
      else if (!state.cycleFormValid)
        reject(
          state,
          'form',
          form.cue ??
            'Rep not counted. Ask your coach to correct your alignment before continuing.',
          timestamp,
        );
      else if (timestamp - state.lastRepAt < profile.cooldownMs)
        reject(state, 'cooldown', 'Finish one controlled movement at a time.', timestamp);
      else {
        const formScore = state.cycleFormTotal / Math.max(1, state.cycleSamples);
        const confidenceScore = (state.cycleConfidenceTotal / Math.max(1, state.observedMs)) * 100;
        const rangeScore = Math.min(
          100,
          (range / Math.max(1, Math.abs(config.topAngle - config.bottomAngle))) * 100,
        );
        const timingScore = state.observedMs >= Math.max(800, config.minRepMs) ? 100 : 85;
        // Layer 12: score the completed cycle, rather than the last camera frame.
        state.lastRepQuality = state.cycleSamples
          ? clamp(formScore * 0.5 + rangeScore * 0.25 + confidenceScore * 0.15 + timingScore * 0.1)
          : null;
        state.reps += 1;
        state.lastRepAt = timestamp;
        state.lastRange = Math.round(range);
        state.lastDuration = state.observedMs / 1000;
        state.rejectionReason = null;
        state.feedbackUntil = 0;
      }
      state.stage = 'ready';
    }
  }
  if (timestamp >= state.feedbackUntil) state.rejectionReason = null;
  const phase =
    state.stage === 'seek'
      ? 'find start position'
      : atStart
        ? exercise === 'curl'
          ? 'arm extended'
          : 'start position'
        : atEnd
          ? exercise === 'curl'
            ? 'curled'
            : 'lowered'
          : 'moving';
  const cue =
    timestamp < state.feedbackUntil
      ? state.feedback
      : (form.cue ??
        (state.stage === 'seek'
          ? profile.startCue
          : atStart
            ? profile.moveCue
            : atEnd || state.bottomSeen
              ? profile.returnCue
              : profile.moveCue));
  state.lastTimestamp = timestamp;
  state.rawVelocity = rawVelocity;
  state.lastObservedAt = timestamp;
  return {
    reps: state.reps,
    holdSeconds: Math.floor(state.holdMs / 1000),
    score: form.score,
    confidence,
    phase,
    cue,
    angle: Math.round(angle),
    tracked: true,
    postureValid: form.valid,
    ruleVersion: RULE_VERSION,
    rangeDegrees: state.lastRange,
    lastRepSeconds: state.lastDuration,
    lastRepQuality: state.lastRepQuality,
    rejectionReason: state.rejectionReason,
    geometrySource: source,
    trackedSide: side === 0 ? 'left' : 'right',
    filteredLandmarks: filtered,
  };
}

export const skeletonConnections = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];
