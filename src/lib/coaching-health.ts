export type CoachingHealthEvent =
  | 'model_startup_failed'
  | 'inference_slow'
  | 'tracking_low'
  | 'save_failed'
  | 'media_join_failed'
  | 'media_reconnected'
  | 'stale_summary';
export type CoachingHealthDetails = {
  durationMs?: number;
  /**
   * The class the event happened in. The server derives the user from the session and
   * logs this id (and its studio) only when that user may take part in the class.
   */
  classId?: string | null;
};
const lastReported = new Map<CoachingHealthEvent, number>();
/** Coarse operational events only. No frame, joint, message, or device identifiers. */
export function reportCoachingHealth(
  event: CoachingHealthEvent,
  enabled: boolean,
  details: CoachingHealthDetails = {},
) {
  if (!enabled || Date.now() - (lastReported.get(event) ?? 0) < 60000) return;
  lastReported.set(event, Date.now());
  void fetch('/api/coaching-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(healthBody(event, details)),
  }).catch(() => {});
}
export function healthBody(event: CoachingHealthEvent, details: CoachingHealthDetails = {}) {
  return {
    event,
    ...(details.durationMs !== undefined && Number.isFinite(details.durationMs)
      ? { durationMs: Math.min(60000, Math.max(0, Math.round(details.durationMs))) }
      : {}),
    ...(details.classId && details.classId.length <= 100 ? { classId: details.classId } : {}),
  };
}
