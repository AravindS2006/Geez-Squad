import type { ArmMode } from './exercise-library';
export type RepEvent = {
  id: string;
  side: 'left' | 'right';
  startedAt: number;
  endedAt: number;
  observedMs: number;
  rangeDegrees: number;
  quality: number | null;
};
export type ArmSummary = {
  reps: number;
  rangeDegrees: number | null;
  repSeconds: number | null;
  trackedMs: number;
  activeMs: number;
};
export type Arms = { left: ArmSummary; right: ArmSummary };
export const emptyArm = (): ArmSummary => ({
  reps: 0,
  rangeDegrees: null,
  repSeconds: null,
  trackedMs: 0,
  activeMs: 0,
});
export type RepCoordinator = {
  pending: RepEvent[];
  seen: string[];
  pairs: number;
  previousSide: 'left' | 'right' | null;
  sequenceCue: string | null;
};
export const initialRepCoordinator = (): RepCoordinator => ({
  pending: [],
  seen: [],
  pairs: 0,
  previousSide: null,
  sequenceCue: null,
});
/** Consume each event once. Sequential, non-overlapping curls cannot form a bilateral rep. */
export function coordinateReps(
  state: RepCoordinator,
  mode: ArmMode,
  events: RepEvent[],
  now: number,
) {
  state.pending = state.pending.filter((e) => now - e.endedAt <= 750);
  for (const event of events) {
    if (state.seen.includes(event.id)) continue;
    state.seen = [...state.seen.slice(-255), event.id];
    if (mode === 'alternating') {
      state.sequenceCue =
        state.previousSide === event.side
          ? `Alternate arms. Your ${event.side} movement was recorded.`
          : null;
      state.previousSide = event.side;
    }
    if (mode !== 'both') continue;
    const index = state.pending.findIndex(
      (other) =>
        other.side !== event.side &&
        Math.abs(other.endedAt - event.endedAt) <= 750 &&
        Math.max(other.startedAt, event.startedAt) < Math.min(other.endedAt, event.endedAt),
    );
    if (index >= 0) {
      state.pending.splice(index, 1);
      state.pairs++;
      state.sequenceCue = null;
    } else {
      state.pending.push(event);
      state.sequenceCue = 'Move both arms together. Each arm’s movement is recorded separately.';
    }
  }
  return state.pairs;
}
