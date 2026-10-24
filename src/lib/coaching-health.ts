export type CoachingHealthEvent =
  | 'model_startup_failed'
  | 'inference_slow'
  | 'tracking_low'
  | 'save_failed'
  | 'media_join_failed'
  | 'media_reconnected'
  | 'stale_summary';
const lastReported = new Map<CoachingHealthEvent, number>();
/** Coarse operational events only. No frame, joint, message, or device identifiers. */
export function reportCoachingHealth(
  event: CoachingHealthEvent,
  enabled: boolean,
  durationMs?: number,
) {
  if (!enabled || Date.now() - (lastReported.get(event) ?? 0) < 60000) return;
  lastReported.set(event, Date.now());
  void fetch('/api/coaching-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      ...(durationMs !== undefined
        ? { durationMs: Math.min(60000, Math.max(0, Math.round(durationMs))) }
        : {}),
    }),
  }).catch(() => {});
}
