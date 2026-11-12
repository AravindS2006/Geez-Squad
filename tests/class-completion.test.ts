import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  audit: vi.fn(),
  deleteRoom: vi.fn(),
  removeParticipant: vi.fn(),
}));
vi.mock('@/lib/db', () => {
  const classSession = {
    updateMany: fx.updateMany,
    findUnique: fx.findUnique,
    findMany: fx.findMany,
  };
  const tx = { classSession, auditEvent: { create: fx.audit } };
  return {
    isSqliteDatabase: () => false,
    db: { ...tx, $transaction: (run: (store: typeof tx) => unknown) => run(tx) },
  };
});
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    deleteRoom = fx.deleteRoom;
    removeParticipant = fx.removeParticipant;
  },
}));
import {
  LIFECYCLE_ACTOR,
  closeClassRoom,
  completeAbandonedClasses,
  completeLiveClass,
  recordClassPresence,
} from '../src/lib/class-completion';

const start = new Date('2026-11-12T10:00:00Z');
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const room = { id: 'class', videoRoomName: 'geez-squad-class' };
const liveRow = (over: Record<string, unknown> = {}) => ({
  ...room,
  status: 'live',
  startedAt: start,
  duration: 45,
  hostLastSeenAt: at(20),
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('LIVEKIT_URL', 'wss://livekit.example.test');
  vi.stubEnv('LIVEKIT_API_KEY', 'test');
  vi.stubEnv('LIVEKIT_API_SECRET', 'test');
  fx.updateMany.mockResolvedValue({ count: 1 });
  fx.deleteRoom.mockResolvedValue(undefined);
});

describe('completeLiveClass', () => {
  it('commits completion and its audit, then closes the room with one deletion', async () => {
    const order: string[] = [];
    fx.updateMany.mockImplementation(async () => (order.push('update'), { count: 1 }));
    fx.audit.mockImplementation(async () => order.push('audit'));
    fx.deleteRoom.mockImplementation(async () => order.push('deleteRoom'));
    const result = await completeLiveClass(room, {
      actorId: 'coach',
      action: 'end',
      guard: { revision: 3, hostId: 'coach' },
    });
    expect(result).toEqual({ completed: true, alreadyCompleted: false, roomClosed: true });
    expect(order).toEqual(['update', 'audit', 'deleteRoom']);
    expect(fx.updateMany.mock.calls[0][0].where).toEqual({
      revision: 3,
      hostId: 'coach',
      id: 'class',
      status: 'live',
    });
    expect(fx.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'completed',
      paused: true,
    });
    expect(fx.deleteRoom).toHaveBeenCalledTimes(1);
    expect(fx.deleteRoom).toHaveBeenCalledWith('geez-squad-class');
    expect(fx.removeParticipant).not.toHaveBeenCalled();
  });
  it('reports the class as ended when room teardown fails', async () => {
    fx.deleteRoom.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    const result = await completeLiveClass(room, { actorId: 'coach', action: 'end' });
    expect(result).toEqual({ completed: true, alreadyCompleted: false, roomClosed: false });
  });
  it('treats an already-deleted room as closed', async () => {
    fx.deleteRoom.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    expect(await closeClassRoom(room)).toBe(true);
  });
  it('is idempotent: a concurrent completion is reported as already completed, without a second audit', async () => {
    fx.updateMany.mockResolvedValue({ count: 0 });
    fx.findUnique.mockResolvedValue({ status: 'completed' });
    const result = await completeLiveClass(room, { actorId: 'coach', action: 'end' });
    expect(result).toEqual({ completed: false, alreadyCompleted: true, roomClosed: true });
    expect(fx.audit).not.toHaveBeenCalled();
  });
  it('does not tear down a room when the class was not completed', async () => {
    fx.updateMany.mockResolvedValue({ count: 0 });
    fx.findUnique.mockResolvedValue({ status: 'live' });
    const result = await completeLiveClass(room, { actorId: 'coach', action: 'end' });
    expect(result).toEqual({ completed: false, alreadyCompleted: false, roomClosed: null });
    expect(fx.deleteRoom).not.toHaveBeenCalled();
  });
});

describe('recordClassPresence', () => {
  it('writes coach presence only when the throttle window has passed', async () => {
    await recordClassPresence(liveRow({ hostLastSeenAt: at(20) }), true, at(20.25));
    expect(fx.updateMany).not.toHaveBeenCalled();
    await recordClassPresence(liveRow({ hostLastSeenAt: at(20) }), true, at(21));
    expect(fx.updateMany).toHaveBeenCalledWith({
      where: { id: 'class', status: 'live' },
      data: { hostLastSeenAt: at(21) },
    });
    expect(fx.audit).not.toHaveBeenCalled();
  });
  it('lets a trainee poll complete a class its coach abandoned, guarded by the presence it read', async () => {
    await recordClassPresence(liveRow({ hostLastSeenAt: at(20) }), false, at(31));
    expect(fx.updateMany.mock.calls[0][0].where).toEqual({
      startedAt: start,
      hostLastSeenAt: at(20),
      id: 'class',
      status: 'live',
    });
    expect(fx.audit).toHaveBeenCalledWith({
      data: {
        actorId: LIFECYCLE_ACTOR,
        action: 'autoEnd',
        targetId: 'class',
        detailsJson: { reason: 'host_absent' },
      },
    });
    expect(fx.deleteRoom).toHaveBeenCalledTimes(1);
  });
  it('never completes a class from a trainee poll while the coach is present', async () => {
    await recordClassPresence(liveRow({ hostLastSeenAt: at(25) }), false, at(30));
    expect(fx.updateMany).not.toHaveBeenCalled();
  });
  it('a coach poll past the hard maximum completes the class', async () => {
    await recordClassPresence(liveRow({ hostLastSeenAt: at(104.9) }), true, at(105));
    expect(fx.audit.mock.calls[0][0].data.detailsJson).toEqual({ reason: 'max_duration' });
  });
  it('ignores classes that are not live and never throws into the poll', async () => {
    await recordClassPresence(liveRow({ status: 'completed' }), false, at(500));
    expect(fx.updateMany).not.toHaveBeenCalled();
    fx.updateMany.mockRejectedValue(new Error('db down'));
    await expect(recordClassPresence(liveRow(), true, at(30))).resolves.toBeUndefined();
  });
});

describe('completeAbandonedClasses (scheduled job)', () => {
  it('completes only abandoned or over-long live classes', async () => {
    fx.findMany.mockResolvedValue([
      liveRow({ id: 'active', hostLastSeenAt: at(59) }),
      liveRow({ id: 'abandoned', hostLastSeenAt: at(30) }),
      liveRow({ id: 'legacy', hostLastSeenAt: null }),
    ]);
    const summary = await completeAbandonedClasses(at(60));
    expect(summary).toEqual({ checked: 3, completed: 2, roomsLeftOpen: 0 });
    const completedIds = fx.updateMany.mock.calls.map((call) => call[0].where.id);
    expect(completedIds).toEqual(['abandoned', 'legacy']);
    expect(fx.findMany.mock.calls[0][0].where).toEqual({
      status: 'live',
      startedAt: { lte: at(50) },
    });
  });
  it('counts rooms whose teardown must be retried', async () => {
    fx.findMany.mockResolvedValue([liveRow({ hostLastSeenAt: null })]);
    fx.deleteRoom.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
    expect(await completeAbandonedClasses(at(60))).toEqual({
      checked: 1,
      completed: 1,
      roomsLeftOpen: 1,
    });
  });
});
