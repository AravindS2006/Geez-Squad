import type { Block, Plan } from './types';
import type { Arms } from './rep-events';

/** Legacy blocks get a stable occurrence identity, including repeated exercises. */
export function planBlocks(plan: Pick<Plan, 'id' | 'blocks'>): Block[] {
  return plan.blocks.map((b, index) => ({ ...b, id: b.id ?? `${plan.id}:${index}` }));
}
export function setArms(current: Arms | undefined, baseline: Arms | undefined): Arms | null {
  if (!current) return null;
  const subtract = (side: 'left' | 'right') => ({
    ...current[side],
    rangeDegrees:
      current[side].reps > (baseline?.[side].reps ?? 0) ? current[side].rangeDegrees : null,
    repSeconds: current[side].reps > (baseline?.[side].reps ?? 0) ? current[side].repSeconds : null,
    reps: Math.max(0, current[side].reps - (baseline?.[side].reps ?? 0)),
    trackedMs: Math.max(0, current[side].trackedMs - (baseline?.[side].trackedMs ?? 0)),
    activeMs: Math.max(0, current[side].activeMs - (baseline?.[side].activeMs ?? 0)),
  });
  return { left: subtract('left'), right: subtract('right') };
}
export type RunCheckpoint = {
  version: 2;
  owner: string;
  exercise: string;
  classId: string | null;
  revision: number;
  runId: string;
  blockId: string | null;
  reps: number;
  holdMs: number;
  arms?: Arms;
  config: import('./workout-config').WorkoutConfig;
  completedSets: number;
  updatedAt: number;
  results?: {
    number: number;
    amount: number;
    score: number | null;
    range: number;
    tempo: number;
    quality: number | null;
  }[];
  unfinished?: import('./types').WorkoutSetRecord;
  records?: import('./types').WorkoutSetRecord[];
  restUntil?: number;
  saveConsented?: boolean;
};
export function readRunCheckpoint(
  key: string,
  owner: string,
  exercise: string,
  classId: string | null,
  revision: number,
): RunCheckpoint | null {
  try {
    const c = JSON.parse(localStorage.getItem(key) ?? 'null') as RunCheckpoint | null;
    return c?.version === 2 &&
      c.owner === owner &&
      c.exercise === exercise &&
      c.classId === classId &&
      c.revision === revision &&
      Number.isInteger(c.reps) &&
      Number.isFinite(c.holdMs) &&
      c.reps >= 0 &&
      c.reps <= 5000 &&
      c.holdMs >= 0 &&
      c.holdMs <= 7200000 &&
      typeof c.runId === 'string' &&
      c.runId.length <= 100 &&
      c.config &&
      typeof c.config === 'object' &&
      Number.isFinite(c.updatedAt) &&
      c.updatedAt <= Date.now() + 30000 &&
      Date.now() - c.updatedAt < 86400000
      ? c
      : null;
  } catch {
    return null;
  }
}
