// Trainee cue text for a limb that is too uncertain to track. Pure and free of
// engine imports. The failure test mirrors confidenceOf in pose-engine.ts: a joint
// fails exactly when its confidence is below the 0.65 floor, so this module only
// explains an outcome the engine already decided and never changes it.
type CuePoint = { x: number; y: number; visibility?: number; presence?: number };
type JointFailure = 'frame' | 'visibility';

const names: Record<number, string> = {
  11: 'shoulder',
  13: 'elbow',
  15: 'wrist',
  23: 'hip',
  25: 'knee',
  27: 'ankle',
  29: 'heel',
  31: 'foot',
};
const floor = 0.65;

// 'frame': missing, non-finite or at the frame edge (the person can step back or
// recentre). 'visibility': inside the frame but low visibility or presence.
function failureOf(point: CuePoint | undefined): JointFailure | null {
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
    return 'frame';
  const confidence = Math.max(0, Math.min(1, point.visibility ?? 0, point.presence ?? 1));
  return confidence < floor ? 'visibility' : null;
}

function phrase(items: string[]): string {
  if (items.length <= 3) {
    return items.length > 1
      ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
      : items[0];
  }
  const sides = new Set(items.map((item) => item.split(' ')[0]));
  return `${[...sides].join(' and ')} joints`;
}

export function occlusionCue(
  pose: readonly (CuePoint | undefined)[],
  joints: readonly number[],
  bilateral: boolean,
  side: number,
): string {
  // Landmark index + 0 is the person's left, + 1 the right; labels never swap.
  const sides = bilateral ? [0, 1] : [side];
  const frame: string[] = [];
  const low: string[] = [];
  for (const limb of sides)
    for (const index of joints) {
      const failure = failureOf(pose[index + limb]);
      if (!failure) continue;
      (failure === 'frame' ? frame : low).push(
        `${limb === 0 ? 'left' : 'right'} ${names[index] ?? 'body joint'}`,
      );
    }
  const verb = (items: string[]) => (items.length > 1 ? 'are' : 'is');
  if (frame.length && low.length)
    return `Step back or recentre to fit your ${phrase(frame)}. Improve lighting for your ${phrase(low)}.`;
  if (frame.length) return `Step back or recentre so your ${phrase(frame)} ${verb(frame)} in view.`;
  if (low.length)
    return `Your ${phrase(low)} ${verb(low)} unclear. Improve lighting or turn slightly toward the camera.`;
  return 'Improve lighting or turn slightly toward the camera so the required joints are clear.';
}
