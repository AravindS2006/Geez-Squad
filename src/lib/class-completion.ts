import 'server-only';
import type { Prisma } from '@prisma/client';
import { RoomServiceClient } from 'livekit-server-sdk';
import { db, isSqliteDatabase } from './db';
import { errorContext, logEvent } from './logger';
import { writeMetrics as writeTransaction } from './metrics-write';
import { existingVideoRoomName } from './room-identity';
import {
  HOST_ABSENCE_GRACE_MS,
  autoCompleteReason,
  hostPresenceDue,
  type AutoCompleteReason,
  type LiveClassClock,
} from './class-lifecycle';

/** Audit actor for completions made by the server rather than a person. */
export const LIFECYCLE_ACTOR = 'system:class-lifecycle';

type RoomRef = { id: string; videoRoomName: string | null };

export function videoRoomService() {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
  if (!url || !key || !secret) return null;
  return new RoomServiceClient(
    url.replace('wss://', 'https://').replace('ws://', 'http://'),
    key,
    secret,
  );
}

export function isRoomMissing(error: unknown) {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 404;
}

/**
 * Close a class's LiveKit room with one `deleteRoom` call. LiveKit disconnects
 * every participant when the room is deleted, and the token route only issues
 * (5-minute) tokens while the class is live, so no per-identity removal is
 * needed. A missing room counts as closed. Never throws: completion is already
 * committed, so a failure is logged and reported as `false` for a later retry.
 */
export async function closeClassRoom(item: RoomRef): Promise<boolean> {
  const service = videoRoomService();
  if (!service) return true;
  try {
    await service.deleteRoom(existingVideoRoomName(item));
    return true;
  } catch (error) {
    if (isRoomMissing(error)) return true;
    logEvent('warn', 'class_room_close_failed', {
      targetId: item.id,
      provider: 'livekit',
      ...errorContext(error),
    });
    return false;
  }
}

export type CompletionResult = {
  /** This call moved the class from live to completed. */
  completed: boolean;
  /** The class was already completed (by End, a poll or the scheduled job). */
  alreadyCompleted: boolean;
  /** Room teardown outcome; null when the class is not completed. */
  roomClosed: boolean | null;
};

/**
 * The single way a live class becomes completed (coach End, abandoned-class
 * poll check and the scheduled job). The status change and its audit event
 * commit together through a conditional update, so concurrent callers complete
 * the class exactly once; the loser sees `alreadyCompleted`. Room teardown runs
 * only after the commit, and its failure never undoes or hides the completion.
 */
export async function completeLiveClass(
  item: RoomRef,
  options: {
    actorId: string;
    action: string;
    /** Extra optimistic conditions (revision, host, presence) the row must still meet. */
    guard?: Prisma.ClassSessionWhereInput;
    details?: Prisma.InputJsonValue;
    now?: Date;
  },
): Promise<CompletionResult> {
  const now = options.now ?? new Date();
  const completed = await writeTransaction(
    () =>
      db.$transaction(async (tx) => {
        const updated = await tx.classSession.updateMany({
          where: { ...options.guard, id: item.id, status: 'live' },
          data: {
            status: 'completed',
            endedAt: now,
            paused: true,
            controlSequence: { increment: 1 },
          },
        });
        if (!updated.count) return false;
        await tx.auditEvent.create({
          data: {
            actorId: options.actorId,
            action: options.action,
            targetId: item.id,
            ...(options.details === undefined ? {} : { detailsJson: options.details }),
          },
        });
        return true;
      }),
    isSqliteDatabase(),
  );
  if (!completed) {
    const current = await db.classSession.findUnique({
      where: { id: item.id },
      select: { status: true },
    });
    if (current?.status !== 'completed')
      return { completed: false, alreadyCompleted: false, roomClosed: null };
  }
  return { completed, alreadyCompleted: !completed, roomClosed: await closeClassRoom(item) };
}

type LiveClassRow = RoomRef & LiveClassClock;

/** Complete an unattended class, unless the coach was seen after this row was read. */
export async function autoCompleteClass(
  item: LiveClassRow,
  reason: AutoCompleteReason,
  now = new Date(),
) {
  const result = await completeLiveClass(item, {
    actorId: LIFECYCLE_ACTOR,
    action: 'autoEnd',
    // A presence write after this read makes the conditional update miss.
    guard:
      reason === 'host_absent'
        ? { startedAt: item.startedAt, hostLastSeenAt: item.hostLastSeenAt }
        : { startedAt: item.startedAt },
    details: { reason },
    now,
  });
  if (result.completed)
    logEvent('info', 'class_auto_completed', {
      targetId: item.id,
      reason,
      roomClosed: result.roomClosed,
    });
  return result;
}

/**
 * Hook for the class poll (GET /api/classes/[id]), run after the response.
 * A managing coach's poll records presence at most every 30 s. Any poll of a
 * class past its hard maximum, and a trainee poll of a class whose coach has
 * been absent past the grace period, completes it. Errors are logged only:
 * the poll response never depends on this bookkeeping.
 */
export async function recordClassPresence(item: LiveClassRow, manager: boolean, now = new Date()) {
  if (item.status !== 'live') return;
  try {
    const reason = autoCompleteReason(item, now);
    if (reason === 'max_duration' || (reason && !manager)) {
      await autoCompleteClass(item, reason, now);
      return;
    }
    if (manager && hostPresenceDue(item.hostLastSeenAt, now))
      await db.classSession.updateMany({
        where: { id: item.id, status: 'live' },
        data: { hostLastSeenAt: now },
      });
  } catch (error) {
    logEvent('warn', 'class_presence_failed', { targetId: item.id, ...errorContext(error) });
  }
}

/**
 * Scheduled backstop (retention cron): complete every live class whose coach
 * is absent past the grace period or that exceeded its hard maximum, even when
 * nobody is polling it. Bounded per run; the rest are picked up next run.
 */
export async function completeAbandonedClasses(now = new Date(), limit = 50) {
  const candidates = await db.classSession.findMany({
    // Neither reason can apply before the grace period has passed since start.
    where: { status: 'live', startedAt: { lte: new Date(now.getTime() - HOST_ABSENCE_GRACE_MS) } },
    select: {
      id: true,
      status: true,
      startedAt: true,
      duration: true,
      hostLastSeenAt: true,
      videoRoomName: true,
    },
    orderBy: { startedAt: 'asc' },
    take: limit * 4,
  });
  let completed = 0;
  let roomsLeftOpen = 0;
  for (const item of candidates) {
    if (completed >= limit) break;
    const reason = autoCompleteReason(item, now);
    if (!reason) continue;
    const result = await autoCompleteClass(item, reason, now);
    if (result.completed) completed++;
    if (result.roomClosed === false) roomsLeftOpen++;
  }
  return { checked: candidates.length, completed, roomsLeftOpen };
}
