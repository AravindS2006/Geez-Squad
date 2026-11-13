/**
 * Pure live-class lifecycle policy: when an unattended live class is completed
 * automatically, how often the managing coach's presence is recorded, and the
 * per-action rate-limit buckets of the command dispatcher. No I/O here; the
 * server side lives in `class-completion.ts`.
 */
import { MAX_CLASS_CLIENTS } from './class-policy';

/** Record the coach's poll at most this often (one cheap UPDATE per coach per 30 s). */
export const HOST_PRESENCE_WRITE_INTERVAL_MS = 30_000;
/**
 * A live class whose managing coach has not polled for this long is treated as
 * abandoned. Generous enough for a backgrounded tab (browsers throttle timers to
 * about once a minute) and a short network drop.
 */
export const HOST_ABSENCE_GRACE_MS = 10 * 60_000;
/** A live class may overrun its planned duration by this much, coach present or not. */
export const LIVE_OVERRUN_MS = 60 * 60_000;
/** Absolute ceiling, matching the LiveKit room's 3-hour idle timeout set at start. */
export const MAX_LIVE_MS = 3 * 60 * 60_000;

/** LiveKit token revocations in flight at once while closing a room. */
export const ROOM_REVOCATION_CONCURRENCY = 8;

/** `Promise.allSettled` over `items` with at most `limit` calls in flight; results keep input order. */
export async function settleBounded<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

export type AutoCompleteReason = 'host_absent' | 'max_duration';

export type LiveClassClock = {
  status: string;
  startedAt: Date | null;
  duration: number;
  hostLastSeenAt: Date | null;
};

/** Latest moment a live class may still be running, regardless of coach presence. */
export function liveClassDeadline(item: Pick<LiveClassClock, 'startedAt' | 'duration'>) {
  if (!item.startedAt) return null;
  const allowed = Math.min(item.duration * 60_000 + LIVE_OVERRUN_MS, MAX_LIVE_MS);
  return new Date(item.startedAt.getTime() + allowed);
}

/**
 * Why a live class should be completed now, or null when it should keep running.
 * A class that started before presence was recorded (null `hostLastSeenAt`) is
 * measured from its start time, so legacy live rows are still swept.
 */
export function autoCompleteReason(
  item: LiveClassClock,
  now = new Date(),
): AutoCompleteReason | null {
  if (item.status !== 'live' || !item.startedAt) return null;
  const deadline = liveClassDeadline(item);
  if (deadline && now.getTime() >= deadline.getTime()) return 'max_duration';
  const seen = item.hostLastSeenAt ?? item.startedAt;
  if (now.getTime() - seen.getTime() >= HOST_ABSENCE_GRACE_MS) return 'host_absent';
  return null;
}

/** True when the coach's presence write is due (throttled to keep the poll cheap). */
export function hostPresenceDue(lastSeen: Date | null, now = new Date()) {
  return !lastSeen || now.getTime() - lastSeen.getTime() >= HOST_PRESENCE_WRITE_INTERVAL_MS;
}

/** Commands that act on one live class and are limited per class after authorization. */
export const IN_CLASS_ACTIONS = new Set([
  'message',
  'help',
  'consent',
  'classControl',
  'muteParticipants',
]);

/**
 * Rate-limit buckets (per minute). Every in-class command first passes a wide
 * per-user ceiling before any database read, so unknown class ids cannot be
 * probed without limit. After authorization, the class's coach is limited per
 * class, sized so one cue to every trainee of a full class fits several times a
 * minute; trainees keep the shared command limit and the 20-message cap.
 */
export const COMMAND_LIMITS = {
  /** Every command that is not in-class (plans, invites, profile...). */
  general: { action: 'command', max: 60 },
  /** Pre-authorization ceiling for in-class commands, per user across classes. */
  inClassCeiling: { action: 'class-command', max: 600 },
  /** Trainee in-class actions share the general bucket. */
  traineeInClass: { action: 'command', max: 60 },
  traineeMessage: { action: 'message', max: 20 },
} as const;

/** Design target for one coach's live class (docs/AI_HANDOFF.md). */
export const TARGET_CLASS_TRAINEES = 36;
/**
 * Cues and messages by the coach of one class: an individual cue to each of 36
 * trainees five times a minute, and never less than one cue to every trainee of
 * the largest allowed roster plus broadcasts.
 */
export const COACH_CUE_LIMIT = Math.max(TARGET_CLASS_TRAINEES * 5, MAX_CLASS_CLIENTS + 20);
/** Help clears, mutes and class controls by the coach of one class. */
export const COACH_CONTROL_LIMIT = 240;

export type ClassRateBucket = { action: string; max: number };

/** The rate-limit buckets one authorized in-class command consumes. */
export function classRateBuckets(
  classId: string,
  manager: boolean,
  kind: 'message' | 'control',
): ClassRateBucket[] {
  if (manager)
    return [
      kind === 'message'
        ? { action: `class-cue:${classId}`, max: COACH_CUE_LIMIT }
        : { action: `class-control:${classId}`, max: COACH_CONTROL_LIMIT },
    ];
  return kind === 'message'
    ? [COMMAND_LIMITS.traineeInClass, COMMAND_LIMITS.traineeMessage]
    : [COMMAND_LIMITS.traineeInClass];
}
