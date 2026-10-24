export type CoachingFeatures = { measurement: boolean; library: boolean; meeting: boolean };
/** Build-time emergency switches plus studio-specific rollout controls. Never change mid-set. */
export function coachingFeatures(studio?: unknown): CoachingFeatures {
  const flags = studio && typeof studio === 'object' ? (studio as Record<string, unknown>) : {};
  return {
    measurement:
      process.env.NEXT_PUBLIC_COACHING_MEASUREMENT !== 'off' && flags.measurement !== false,
    library: process.env.NEXT_PUBLIC_COACHING_LIBRARY !== 'off' && flags.library !== false,
    meeting: process.env.NEXT_PUBLIC_COACHING_MEETING !== 'off' && flags.meeting !== false,
  };
}
