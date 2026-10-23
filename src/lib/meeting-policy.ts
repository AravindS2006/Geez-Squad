export const COACH_PAGE_SIZE = 36;
export const CLASSMATE_PAGE_SIZE = 9;

export type MediaSubscription = {
  isCoach: boolean;
  coachId: string;
  presenterIds?: readonly string[];
  cameraIds: readonly string[];
  focusId?: string | null;
};

// LiveKit VideoQuality: LOW=0, MEDIUM=1, HIGH=2. Adaptive streaming
// can still pause hidden video or select a smaller layer under this ceiling.
export function cameraQuality(policy: MediaSubscription, identity: string): 0 | 1 | 2 {
  if (identity === policy.focusId || (!policy.isCoach && identity === policy.coachId)) return 2;
  return policy.isCoach && policy.cameraIds.length <= 16 ? 1 : 0;
}

/** Media outside the visible gallery is never downloaded or decoded. */
export function shouldSubscribe(
  policy: MediaSubscription,
  identity: string,
  source: string,
  muted: boolean,
): boolean {
  if (muted) return false;
  if (source === 'camera')
    return (!policy.isCoach && identity === policy.coachId) || policy.cameraIds.includes(identity);
  if (source === 'microphone') return true;
  return (
    (identity === policy.coachId || !!policy.presenterIds?.includes(identity)) &&
    ['screen_share', 'screen_share_audio'].includes(source)
  );
}
