/**
 * When a trainee's live summary goes to the coach over HTTP (`/api/metrics`).
 *
 * Summaries depend on server-recorded consent and a live, unpaused class, not on the
 * video room: if video drops or never connects, local counting still produces
 * summaries and the coach keeps seeing them. There is one sending path, so nothing is
 * double-sent, and the spacing keeps a trainee well under the metrics rate limit.
 */
/** Minimum spacing between summary posts (the metrics route allows 30 per minute). */
export const SUMMARY_MIN_INTERVAL_MS = 2800;
/** Unchanged summaries are re-sent this often; the coach view treats 12 s as fresh. */
export const SUMMARY_HEARTBEAT_MS = 9000;
/** The metrics route rate limit per user per minute (`rateLimit(user.id, 'metrics', 30)`). */
export const METRICS_RATE_LIMIT_PER_MINUTE = 30;

export type SummaryGate = {
  /** Consent was recorded by the server (not just a ticked checkbox). */
  consentRecorded: boolean;
  classLive: boolean;
  classPaused: boolean;
  hasSnapshot: boolean;
  requestInFlight: boolean;
  now: number;
  lastSentAt: number;
};

export function summaryDue(gate: SummaryGate) {
  return summaryWait(gate) === 0;
}

/**
 * Milliseconds until a summary may be sent (0 = now), or null when it cannot be sent
 * yet for a reason that waiting alone does not fix (consent, class state, no snapshot,
 * a request already in flight).
 */
export function summaryWait(gate: SummaryGate): number | null {
  if (
    !gate.consentRecorded ||
    !gate.classLive ||
    gate.classPaused ||
    !gate.hasSnapshot ||
    gate.requestInFlight
  )
    return null;
  return nextSummaryDelay(gate.now, gate.lastSentAt);
}

/**
 * The part of a summary the coach must see without waiting for the next periodic send:
 * the count, whole hold seconds and whether tracking is available. Score, cue and
 * movement phase change on almost every frame and ride along with the periodic send.
 */
export function summaryUrgentKey(a: { reps: number; holdSeconds: number; phase: string }) {
  return `${a.reps}|${Math.floor(a.holdSeconds)}|${a.phase === 'tracking unavailable' ? 0 : 1}`;
}

/** How long an urgent summary must wait to keep the minimum spacing (0 = send now). */
export function nextSummaryDelay(now: number, lastSentAt: number) {
  return Math.max(0, lastSentAt + SUMMARY_MIN_INTERVAL_MS - now);
}

/** An unchanged body is skipped until the heartbeat interval has passed. */
export function summaryChanged(body: string, lastBody: string, now: number, lastSentAt: number) {
  return body !== lastBody || now - lastSentAt >= SUMMARY_HEARTBEAT_MS;
}
