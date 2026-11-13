import { describe, expect, it } from 'vitest';
import { DisconnectReason } from '@livekit/protocol';
import {
  DISCONNECT_REASON,
  REJOIN_DELAYS_MS,
  REJOIN_STABLE_MS,
  disconnectPolicy,
  mayAutoRejoin,
  rejoinAttemptAfterDrop,
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

  it('keeps counting attempts on a flapping link and resets only after a stable connection', () => {
    const now = 1_000_000;
    // Reconnected 5 s ago, then dropped: the budget is not refilled.
    expect(rejoinAttemptAfterDrop(2, now - 5_000, now)).toBe(2);
    expect(rejoinAttemptAfterDrop(2, null, now)).toBe(2);
    expect(rejoinAttemptAfterDrop(2, now - REJOIN_STABLE_MS, now)).toBe(0);
    // A flap loop: every connect drops within seconds, so the bound is reached.
    let attempt = 0;
    let rejoins = 0;
    for (let i = 0; i < 20; i++) {
      attempt = rejoinAttemptAfterDrop(attempt, now - 3_000, now);
      if (rejoinDelayMs(attempt) === null) break;
      attempt++;
      rejoins++;
    }
    expect(rejoins).toBe(REJOIN_DELAYS_MS.length);
  });

  it('never starts automatic rejoins for a join that did not reach connected', () => {
    const network = disconnectPolicy(DisconnectReason.JOIN_FAILURE);
    expect(mayAutoRejoin(network, false)).toBe(false);
    expect(mayAutoRejoin(network, true)).toBe(true);
    expect(mayAutoRejoin(disconnectPolicy(DisconnectReason.DUPLICATE_IDENTITY), true)).toBe(false);
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
