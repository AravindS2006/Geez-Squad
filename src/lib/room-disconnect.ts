/**
 * What the live room tells a person when LiveKit disconnects them, and whether the
 * client may rejoin on its own. Values mirror `DisconnectReason` from `@livekit/protocol`
 * (asserted in tests/room-disconnect.test.ts) so this module stays free of the SDK.
 */
export const DISCONNECT_REASON = {
  UNKNOWN_REASON: 0,
  CLIENT_INITIATED: 1,
  DUPLICATE_IDENTITY: 2,
  SERVER_SHUTDOWN: 3,
  PARTICIPANT_REMOVED: 4,
  ROOM_DELETED: 5,
  STATE_MISMATCH: 6,
  JOIN_FAILURE: 7,
  MIGRATION: 8,
  SIGNAL_CLOSE: 9,
  ROOM_CLOSED: 10,
  USER_UNAVAILABLE: 11,
  USER_REJECTED: 12,
  SIP_TRUNK_FAILURE: 13,
  CONNECTION_TIMEOUT: 14,
  MEDIA_FAILURE: 15,
  AGENT_ERROR: 16,
} as const;

export type DisconnectKind = 'left' | 'duplicate' | 'removed' | 'ended' | 'network' | 'other';
export type DisconnectPolicy = {
  kind: DisconnectKind;
  /** Empty when nothing should be shown (the person left on purpose). */
  message: string;
  /** Show a one-tap rejoin control. */
  offerRejoin: boolean;
  /** Rejoin without a tap, with bounded backoff. Only for transient network causes. */
  autoRejoin: boolean;
};

const R = DISCONNECT_REASON;
const NETWORK = new Set<number>([
  R.UNKNOWN_REASON,
  R.SERVER_SHUTDOWN,
  R.STATE_MISMATCH,
  R.JOIN_FAILURE,
  R.MIGRATION,
  R.SIGNAL_CLOSE,
  R.CONNECTION_TIMEOUT,
  R.MEDIA_FAILURE,
]);

export function disconnectPolicy(reason: number | undefined): DisconnectPolicy {
  // LiveKit leaves the reason empty when its own reconnect attempts give up.
  const code = reason ?? R.UNKNOWN_REASON;
  if (code === R.CLIENT_INITIATED)
    return { kind: 'left', message: '', offerRejoin: false, autoRejoin: false };
  if (code === R.DUPLICATE_IDENTITY)
    return {
      kind: 'duplicate',
      message:
        'You joined this class from another tab or device, so video moved there. Rejoin here to use this screen instead.',
      offerRejoin: true,
      autoRejoin: false,
    };
  if (code === R.PARTICIPANT_REMOVED)
    return {
      kind: 'removed',
      message: 'You were removed from the class video. If your access changed, contact your coach.',
      offerRejoin: true,
      autoRejoin: false,
    };
  if (code === R.ROOM_DELETED || code === R.ROOM_CLOSED)
    return {
      kind: 'ended',
      message: 'Class video ended.',
      offerRejoin: false,
      autoRejoin: false,
    };
  if (NETWORK.has(code))
    return {
      kind: 'network',
      message: 'Video connection lost. Your camera tracking and saved sets are not affected.',
      offerRejoin: true,
      autoRejoin: true,
    };
  return {
    kind: 'other',
    message: 'Video disconnected.',
    offerRejoin: true,
    autoRejoin: false,
  };
}

/** Delays before automatic rejoin attempts; the list length is the attempt bound. */
export const REJOIN_DELAYS_MS = [2000, 5000, 12000] as const;

/** Delay before automatic attempt `attempt` (0-based), or null when the bound is reached. */
export function rejoinDelayMs(attempt: number): number | null {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < REJOIN_DELAYS_MS.length
    ? REJOIN_DELAYS_MS[attempt]
    : null;
}
