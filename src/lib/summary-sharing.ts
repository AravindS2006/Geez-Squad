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
  return (
    gate.consentRecorded &&
    gate.classLive &&
    !gate.classPaused &&
    gate.hasSnapshot &&
    !gate.requestInFlight &&
    gate.now - gate.lastSentAt >= SUMMARY_MIN_INTERVAL_MS
  );
}

/** An unchanged body is skipped until the heartbeat interval has passed. */
export function summaryChanged(body: string, lastBody: string, now: number, lastSentAt: number) {
  return body !== lastBody || now - lastSentAt >= SUMMARY_HEARTBEAT_MS;
}
