/** Accessible text for live-room controls whose visual content is compact. */

export type TileLabelInput = {
  name: string;
  helpRequested: boolean;
  paused: boolean;
  /** Null when there is no fresh summary for the current exercise. */
  metric: {
    reps: number;
    holdSeconds: number;
    timed: boolean;
    technique: 'steady' | 'adjust' | 'uncertain' | 'manual';
    tracked: boolean;
    arms?: { left: number; right: number } | null;
  } | null;
  /** LiveKit connection quality, or null when the trainee has no video. */
  connection: string | null;
};

/** The accessible name of a coach gallery tile (kept short: tests and scripts match it). */
export function galleryTileName(input: Pick<TileLabelInput, 'name' | 'helpRequested'>) {
  return `Focus ${input.name}${input.helpRequested ? ', help requested' : ''}`;
}

/**
 * The accessible description of a coach gallery tile. The tile is a button whose
 * aria-label replaces its visible stats, so this repeats them in reading order and
 * is wired up through aria-describedby.
 */
export function galleryTileDescription(input: TileLabelInput) {
  const parts: string[] = [];
  const m = input.metric;
  if (input.paused) parts.push('Class paused');
  else if (!m) parts.push('No recent summary');
  else {
    parts.push(
      m.timed ? `${m.holdSeconds} seconds hold` : `${m.reps} ${m.reps === 1 ? 'rep' : 'reps'}`,
    );
    if (m.arms) parts.push(`left ${m.arms.left}, right ${m.arms.right}`);
    parts.push(
      m.technique === 'manual'
        ? 'manual count'
        : m.technique === 'uncertain'
          ? 'technique uncertain'
          : `technique ${m.technique}`,
    );
    parts.push(m.tracked ? 'tracking' : 'no recent tracking');
  }
  if (!input.connection) parts.push('video not joined');
  else if (input.connection !== 'unknown') parts.push(`${input.connection} connection`);
  return parts.join(', ') + '.';
}

/** A coach cue stays readable for this long, then gives the screen back (chat keeps it). */
export const CUE_VISIBLE_MS = 20000;

/**
 * Auto-hide delay for the coach cue banner: null while the trainee keeps it, hovers it
 * or has focus inside it. Releasing a hold restarts the full delay.
 */
export function cueHideDelay(hold: { kept: boolean; hovered: boolean; focused: boolean }) {
  return hold.kept || hold.hovered || hold.focused ? null : CUE_VISIBLE_MS;
}
