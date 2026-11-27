/**
 * Pure geometry for the live room shell: where the side panel goes, how far it may be
 * resized or moved, and which corner a dragged floating tile snaps to. Components keep
 * pointer and DOM work; every number they apply comes from here so it can be tested.
 */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type PanelDock = 'docked' | 'floating';
/** How the panel is shown right now. Sheets are chosen by the viewport, never saved. */
export type PanelPresentation = 'docked' | 'floating' | 'side-sheet' | 'sheet';
export type PanelPreference = { dock: PanelDock; width: number; rect: Rect | null };

export const PANEL_MIN_WIDTH = 300;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_DEFAULT_WIDTH = 380;
/** The docked panel never takes more than this share of the room width. */
export const PANEL_MAX_SHARE = 0.45;
export const FLOATING_MIN_HEIGHT = 280;
export const FLOATING_DEFAULT_HEIGHT = 520;
/** Floating windows keep this gap from the room edges. */
export const FLOATING_MARGIN = 8;
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;
/** A press that moves less than this is a tap, not a drag. */
export const DRAG_THRESHOLD = 8;
/** Same breakpoints as the rest of the room (`max-width: 760px`, `max-height: 550px`). */
export const PHONE_MAX_WIDTH = 760;
export const SHORT_MAX_HEIGHT = 550;
export const DOCK_MIN_WIDTH = 1024;
export const PANEL_PREFERENCE_KEY = 'geez-squad:room-panel:v1';
export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export const DEFAULT_PANEL_PREFERENCE: PanelPreference = {
  dock: 'docked',
  width: PANEL_DEFAULT_WIDTH,
  rect: null,
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function panelPresentation(viewport: Size, dock: PanelDock): PanelPresentation {
  if (viewport.width <= PHONE_MAX_WIDTH) return 'sheet';
  if (viewport.height <= SHORT_MAX_HEIGHT || viewport.width < DOCK_MIN_WIDTH) return 'side-sheet';
  return dock;
}

/** Largest docked width the room allows: the fixed maximum or 45% of the room. */
export function maxDockedWidth(roomWidth: number) {
  return Math.max(
    PANEL_MIN_WIDTH,
    Math.min(PANEL_MAX_WIDTH, Math.floor(roomWidth * PANEL_MAX_SHARE)),
  );
}

export function clampDockedWidth(width: number, roomWidth: number) {
  return Math.round(clamp(width, PANEL_MIN_WIDTH, maxDockedWidth(roomWidth)));
}

/** Keyboard resize for a `role="separator"` on the panel's leading (left) edge. */
export function keyboardDockedWidth(
  width: number,
  key: string,
  large: boolean,
  roomWidth: number,
): number | null {
  const step = large ? KEY_STEP_LARGE : KEY_STEP;
  // The separator is on the left edge, so moving it left makes the panel wider.
  if (key === 'ArrowLeft') return clampDockedWidth(width + step, roomWidth);
  if (key === 'ArrowRight') return clampDockedWidth(width - step, roomWidth);
  if (key === 'Home') return clampDockedWidth(PANEL_MIN_WIDTH, roomWidth);
  if (key === 'End') return maxDockedWidth(roomWidth);
  return null;
}

/** A floating rect that fits fully inside the room, shrinking only if the room is smaller. */
export function clampRect(rect: Rect, room: Size): Rect {
  const maxWidth = Math.max(0, room.width - FLOATING_MARGIN * 2);
  const maxHeight = Math.max(0, room.height - FLOATING_MARGIN * 2);
  const width = Math.round(clamp(rect.width, Math.min(PANEL_MIN_WIDTH, maxWidth), maxWidth));
  const height = Math.round(
    clamp(rect.height, Math.min(FLOATING_MIN_HEIGHT, maxHeight), maxHeight),
  );
  return {
    width,
    height,
    x: Math.round(clamp(rect.x, FLOATING_MARGIN, room.width - FLOATING_MARGIN - width)),
    y: Math.round(clamp(rect.y, FLOATING_MARGIN, room.height - FLOATING_MARGIN - height)),
  };
}

/** Where a panel lands the first time it is undocked: the right side of the room. */
export function defaultFloatingRect(room: Size, width = PANEL_DEFAULT_WIDTH): Rect {
  const height = Math.min(FLOATING_DEFAULT_HEIGHT, room.height - FLOATING_MARGIN * 2 - 72);
  return clampRect({ x: room.width - width - 24, y: 72, width, height }, room);
}

export function moveRect(rect: Rect, dx: number, dy: number, room: Size): Rect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, room);
}

export function resizeRect(rect: Rect, dw: number, dh: number, room: Size): Rect {
  // Resizing grows toward the bottom-right corner; the top-left corner stays put unless
  // the room edge forces it.
  const maxWidth = room.width - FLOATING_MARGIN - rect.x;
  const maxHeight = room.height - FLOATING_MARGIN - rect.y;
  return clampRect(
    {
      ...rect,
      width: clamp(rect.width + dw, PANEL_MIN_WIDTH, maxWidth),
      height: clamp(rect.height + dh, FLOATING_MIN_HEIGHT, maxHeight),
    },
    room,
  );
}

/** Arrow-key delta for move and resize handles; null for keys the handle ignores. */
export function arrowDelta(key: string, large: boolean): { dx: number; dy: number } | null {
  const step = large ? KEY_STEP_LARGE : KEY_STEP;
  if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
  if (key === 'ArrowRight') return { dx: step, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: -step };
  if (key === 'ArrowDown') return { dx: 0, dy: step };
  return null;
}

export function movedPastThreshold(dx: number, dy: number) {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/** The corner of `bounds` nearest to the centre of a dropped tile. */
export function nearestCorner(tile: Rect, bounds: Rect): Corner {
  const cx = tile.x + tile.width / 2;
  const cy = tile.y + tile.height / 2;
  const left = cx < bounds.x + bounds.width / 2;
  const top = cy < bounds.y + bounds.height / 2;
  return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}` as Corner;
}

export function isCorner(value: unknown): value is Corner {
  return typeof value === 'string' && (CORNERS as readonly string[]).includes(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reads a saved panel preference. Anything malformed falls back to the defaults. */
export function parsePanelPreference(raw: string | null): PanelPreference {
  if (!raw) return DEFAULT_PANEL_PREFERENCE;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof PanelPreference, unknown>>;
    const dock: PanelDock = value.dock === 'floating' ? 'floating' : 'docked';
    const width = finite(value.width)
      ? Math.round(clamp(value.width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH))
      : PANEL_DEFAULT_WIDTH;
    const r = value.rect as Partial<Rect> | null | undefined;
    const rect =
      r &&
      finite(r.x) &&
      finite(r.y) &&
      finite(r.width) &&
      finite(r.height) &&
      r.width > 0 &&
      r.height > 0
        ? { x: r.x, y: r.y, width: r.width, height: r.height }
        : null;
    return { dock, width, rect };
  } catch {
    return DEFAULT_PANEL_PREFERENCE;
  }
}
