import { describe, expect, it } from 'vitest';
import { DisconnectReason } from '@livekit/protocol';
import {
  DISCONNECT_REASON,
  REJOIN_DELAYS_MS,
  disconnectPolicy,
  rejoinDelayMs,
} from '../src/lib/room-disconnect';

describe('disconnect policy', () => {
  it('mirrors the LiveKit DisconnectReason values', () => {
    for (const [name, value] of Object.entries(DISCONNECT_REASON))
      expect(DisconnectReason[name as keyof typeof DisconnectReason], name).toBe(value);
  });

  it('stays silent when the person left on purpose', () => {
    expect(disconnectPolicy(DisconnectReason.CLIENT_INITIATED)).toMatchObject({
      kind: 'left',
      message: '',
      autoRejoin: false,
      offerRejoin: false,
    });
  });

  it('explains a second tab or device and never rejoins on its own', () => {
    const policy = disconnectPolicy(DisconnectReason.DUPLICATE_IDENTITY);
    expect(policy.kind).toBe('duplicate');
    expect(policy.message).toMatch(/another tab or device/);
    expect(policy.autoRejoin).toBe(false);
    expect(policy.offerRejoin).toBe(true);
  });

  it('does not rejoin automatically after removal (access revoked)', () => {
    const policy = disconnectPolicy(DisconnectReason.PARTICIPANT_REMOVED);
    expect(policy.kind).toBe('removed');
    expect(policy.autoRejoin).toBe(false);
  });

  it('treats a deleted or closed room as the class ending, with no rejoin', () => {
    for (const reason of [DisconnectReason.ROOM_DELETED, DisconnectReason.ROOM_CLOSED])
      expect(disconnectPolicy(reason)).toMatchObject({
        kind: 'ended',
        message: 'Class video ended.',
        autoRejoin: false,
        offerRejoin: false,
      });
  });

  it('rejoins automatically only for transient network causes', () => {
    const transient = [
      undefined,
      DisconnectReason.UNKNOWN_REASON,
      DisconnectReason.SIGNAL_CLOSE,
      DisconnectReason.CONNECTION_TIMEOUT,
      DisconnectReason.MEDIA_FAILURE,
      DisconnectReason.SERVER_SHUTDOWN,
      DisconnectReason.STATE_MISMATCH,
      DisconnectReason.JOIN_FAILURE,
      DisconnectReason.MIGRATION,
    ];
    for (const reason of transient) {
      const policy = disconnectPolicy(reason);
      expect(policy.kind, String(reason)).toBe('network');
      expect(policy.message).toMatch(/connection lost/i);
      expect(policy.autoRejoin).toBe(true);
    }
    const automatic = Object.values(DISCONNECT_REASON).filter(
      (reason) => disconnectPolicy(reason).autoRejoin,
    );
    for (const never of [
      DisconnectReason.CLIENT_INITIATED,
      DisconnectReason.DUPLICATE_IDENTITY,
      DisconnectReason.PARTICIPANT_REMOVED,
      DisconnectReason.ROOM_DELETED,
      DisconnectReason.ROOM_CLOSED,
      DisconnectReason.USER_REJECTED,
    ])
      expect(automatic).not.toContain(never);
  });

  it('bounds automatic rejoin attempts with growing delays', () => {
    expect(REJOIN_DELAYS_MS.length).toBeGreaterThan(0);
    const delays = REJOIN_DELAYS_MS.map((_, attempt) => rejoinDelayMs(attempt)!);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(rejoinDelayMs(REJOIN_DELAYS_MS.length)).toBeNull();
    expect(rejoinDelayMs(-1)).toBeNull();
    expect(rejoinDelayMs(1.5)).toBeNull();
  });
});
