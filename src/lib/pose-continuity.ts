import type { Landmark } from './pose-engine';

type Point = { x: number; y: number; z: number };
type Torso = { points: Point[]; center: Point; length: number };
type Observation = { image: Torso; world: Torso | null };

export type PoseContinuityState = {
  previous: Observation | null;
  candidate: Observation | null;
  candidateSince: number;
  candidateFrames: number;
  candidateReason: 'landmark-identity' | 'view-change' | null;
  lastReliableAt: number | null;
  timestamp: number | null;
  width: number;
  height: number;
};

export type PoseContinuityResult = {
  poses: Landmark[][];
  worldPoses: Landmark[][] | undefined;
  rawPoses: Landmark[][];
  rawWorldPoses: Landmark[][] | undefined;
  rejected: boolean;
  resetRequired: boolean;
  reason: 'landmark-identity' | 'view-change' | 'invalid-frame' | null;
};

const indices = [11, 12, 23, 24];
// Match the rep engine's observation grace. A slow but valid camera frame must
// not gain a stricter cycle-reset rule just because display filters reset sooner.
const gapLimitMs = 450;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function initialPoseContinuity(): PoseContinuityState {
  return {
    previous: null,
    candidate: null,
    candidateSince: 0,
    candidateFrames: 0,
    candidateReason: null,
    lastReliableAt: null,
    timestamp: null,
    width: 0,
    height: 0,
  };
}

function torso(
  pose: Landmark[] | undefined,
  width: number,
  height: number,
  world = false,
): Torso | null {
  if (!pose) return null;
  const points: Point[] = [];
  for (const index of indices) {
    const point = pose[index];
    const visibility = point?.visibility ?? 0;
    const presence = point?.presence ?? 1;
    const confidence = Math.min(visibility, presence);
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(visibility) ||
      !Number.isFinite(presence) ||
      visibility > 1 ||
      presence > 1 ||
      !Number.isFinite(confidence) ||
      confidence < 0.65 ||
      (world && !Number.isFinite(point.z)) ||
      (!world && (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1))
    )
      return null;
    points.push({ x: point.x * width, y: point.y * height, z: world ? point.z! : 0 });
  }
  const length = (distance(points[0], points[2]) + distance(points[1], points[3])) / 2;
  if (!Number.isFinite(length) || length < 0.0001) return null;
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / 4,
    y: points.reduce((sum, point) => sum + point.y, 0) / 4,
    z: points.reduce((sum, point) => sum + point.z, 0) / 4,
  };
  return { points, center, length };
}

function changedView(previous: Torso, current: Torso): boolean {
  return (
    distance(previous.center, current.center) > Math.max(previous.length, current.length) * 0.75 ||
    current.length / previous.length > 1.5 ||
    current.length / previous.length < 1 / 1.5
  );
}

function invertedPair(previous: Torso, current: Torso, pair: number, image: boolean): boolean {
  const a = previous.points[pair],
    b = previous.points[pair + 1];
  const c = current.points[pair],
    d = current.points[pair + 1];
  const oldWidth = distance(a, b),
    newWidth = distance(c, d);
  const minimumWidth = Math.min(previous.length, current.length) * (pair === 0 ? 0.35 : 0.2);
  // At a side-on view the projected points can cross naturally as a trainee
  // turns. Only broad, well-separated pairs can supply identity evidence.
  if (Math.min(oldWidth, newWidth) < minimumWidth) return false;
  const oldVector = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const newVector = { x: c.x - d.x, y: c.y - d.y, z: c.z - d.z };
  const cosine =
    (oldVector.x * newVector.x + oldVector.y * newVector.y + oldVector.z * newVector.z) /
    (oldWidth * newWidth);
  if (cosine > -0.8) return false;
  if (image && (Math.abs(a.x - b.x) < oldWidth * 0.7 || Math.abs(c.x - d.x) < newWidth * 0.7))
    return false;
  const direct = (distance(a, c) + distance(b, d)) / 2;
  const crossed = (distance(a, d) + distance(b, c)) / 2;
  return (
    crossed < Math.min(oldWidth, newWidth) * 0.2 && direct > Math.max(crossed * 3, oldWidth * 0.5)
  );
}

function identityJump(previous: Observation, current: Observation): boolean {
  if (
    invertedPair(previous.image, current.image, 0, true) ||
    invertedPair(previous.image, current.image, 2, true)
  )
    return true;
  return Boolean(
    previous.world &&
    current.world &&
    (invertedPair(previous.world, current.world, 0, false) ||
      invertedPair(previous.world, current.world, 2, false)),
  );
}

function stableTorso(previous: Torso, current: Torso): boolean {
  const scale = Math.min(previous.length, current.length);
  return (
    current.length / previous.length > 0.8 &&
    current.length / previous.length < 1.25 &&
    previous.points.every((point, index) => distance(point, current.points[index]) < scale * 0.2)
  );
}

function stableObservation(previous: Observation, current: Observation): boolean {
  return (
    stableTorso(previous.image, current.image) &&
    (!previous.world || !current.world || stableTorso(previous.world, current.world))
  );
}

/**
 * Rejects abrupt, contradictory anatomical identity observations. This never
 * sorts, remaps, predicts or outputs old landmarks. The last reliable torso is
 * only an association reference through brief occlusion. Both geometry outputs
 * belong to the same accepted current frame; diagnostic raw outputs stay raw.
 */
export function validatePoseContinuity(
  state: PoseContinuityState,
  poses: Landmark[][],
  worldPoses: Landmark[][] | undefined,
  timestamp: number,
  width: number,
  height: number,
): PoseContinuityResult {
  const result: PoseContinuityResult = {
    poses,
    worldPoses,
    rawPoses: poses,
    rawWorldPoses: worldPoses,
    rejected: false,
    resetRequired: false,
    reason: null,
  };
  const reject = (reason: PoseContinuityResult['reason']) => {
    result.poses = [];
    result.worldPoses = [];
    result.rejected = true;
    result.reason = reason;
    return result;
  };
  if (
    Number.isFinite(timestamp) &&
    timestamp >= 0 &&
    state.timestamp !== null &&
    timestamp <= state.timestamp
  )
    return reject('invalid-frame');
  if (
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    Object.assign(state, initialPoseContinuity());
    result.resetRequired = true;
    return reject('invalid-frame');
  }
  const gap = state.timestamp === null ? 0 : timestamp - state.timestamp;
  const differentSource =
    gap > gapLimitMs ||
    (state.timestamp !== null && (state.width !== width || state.height !== height));
  if (differentSource) {
    result.resetRequired = Boolean(state.previous || state.candidate);
    if (result.resetRequired) result.reason = 'view-change';
    Object.assign(state, initialPoseContinuity());
  }
  state.timestamp = timestamp;
  state.width = width;
  state.height = height;
  const image = poses.length === 1 && poses[0].length >= 33 ? torso(poses[0], width, height) : null;
  if (!image) {
    // Existing visibility gates receive the actual current confidence. Keep
    // only a short-lived association reference, never a skeleton for output.
    if (
      poses.length > 1 ||
      state.lastReliableAt === null ||
      timestamp - state.lastReliableAt > gapLimitMs
    ) {
      state.previous = null;
      state.lastReliableAt = null;
    }
    state.candidate = null;
    state.candidateFrames = 0;
    return result;
  }
  const current: Observation = {
    image,
    world: worldPoses?.length === 1 ? torso(worldPoses[0], 1, 1, true) : null,
  };
  if (
    state.previous &&
    !state.candidate &&
    state.lastReliableAt !== null &&
    timestamp - state.lastReliableAt > gapLimitMs
  ) {
    state.previous = null;
    result.resetRequired = true;
    result.reason = 'view-change';
  }
  if (!state.previous) {
    state.previous = current;
    state.lastReliableAt = timestamp;
    return result;
  }
  const inverted = identityJump(state.previous, current);
  const relocated = changedView(state.previous.image, current.image);
  if (!inverted && !relocated) {
    state.previous = current;
    state.lastReliableAt = timestamp;
    state.candidate = null;
    state.candidateFrames = 0;
    state.candidateReason = null;
    return result;
  }
  const reason = inverted ? 'landmark-identity' : 'view-change';
  if (
    state.candidate &&
    state.candidateReason === reason &&
    stableObservation(state.candidate, current)
  ) {
    state.candidateFrames++;
  } else {
    state.candidateSince = timestamp;
    state.candidateFrames = 1;
  }
  state.candidate = current;
  state.candidateReason = reason;
  if (state.candidateFrames >= 3 && timestamp - state.candidateSince >= 120) {
    // A stable observed new orientation is reacquired, never corrected into an
    // assumed old orientation. An in-flight movement must restart from its top.
    state.previous = current;
    state.lastReliableAt = timestamp;
    state.candidate = null;
    state.candidateFrames = 0;
    result.resetRequired = true;
    result.reason = reason;
    return result;
  }
  return reject(reason);
}
