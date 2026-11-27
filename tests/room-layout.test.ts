import { describe, expect, it } from 'vitest';
import {
  arrowDelta,
  clampDockedWidth,
  clampRect,
  defaultFloatingRect,
  FLOATING_MARGIN,
  keyboardDockedWidth,
  maxDockedWidth,
  movedPastThreshold,
  moveRect,
  nearestCorner,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  panelPresentation,
  parsePanelPreference,
  resizeRect,
} from '../src/lib/room-layout';

describe('panel presentation by viewport', () => {
  it('uses a bottom sheet on phones whatever was saved', () => {
    expect(panelPresentation({ width: 390, height: 844 }, 'docked')).toBe('sheet');
    expect(panelPresentation({ width: 320, height: 568 }, 'floating')).toBe('sheet');
    expect(panelPresentation({ width: 760, height: 1000 }, 'docked')).toBe('sheet');
  });
  it('uses a side sheet on short landscape and tablet widths', () => {
    expect(panelPresentation({ width: 844, height: 390 }, 'docked')).toBe('side-sheet');
    expect(panelPresentation({ width: 1280, height: 550 }, 'floating')).toBe('side-sheet');
    expect(panelPresentation({ width: 768, height: 1024 }, 'docked')).toBe('side-sheet');
    expect(panelPresentation({ width: 1023, height: 900 }, 'docked')).toBe('side-sheet');
  });
  it('honours the saved dock on desktops', () => {
    expect(panelPresentation({ width: 1024, height: 768 }, 'docked')).toBe('docked');
    expect(panelPresentation({ width: 1440, height: 900 }, 'floating')).toBe('floating');
  });
});

describe('docked width', () => {
  it('stays between the minimum and 45% of the room', () => {
    expect(maxDockedWidth(1440)).toBe(PANEL_MAX_WIDTH);
    expect(maxDockedWidth(1024)).toBe(460);
    expect(clampDockedWidth(900, 1024)).toBe(460);
    expect(clampDockedWidth(100, 1440)).toBe(PANEL_MIN_WIDTH);
    // A room too narrow for 45% still gets the minimum usable panel.
    expect(maxDockedWidth(500)).toBe(PANEL_MIN_WIDTH);
  });
  it('moves the left-edge separator with arrow keys, Home and End', () => {
    expect(keyboardDockedWidth(360, 'ArrowLeft', false, 1440)).toBe(376);
    expect(keyboardDockedWidth(360, 'ArrowRight', true, 1440)).toBe(PANEL_MIN_WIDTH);
    expect(keyboardDockedWidth(360, 'Home', false, 1440)).toBe(PANEL_MIN_WIDTH);
    expect(keyboardDockedWidth(360, 'End', false, 1440)).toBe(PANEL_MAX_WIDTH);
    expect(keyboardDockedWidth(550, 'ArrowLeft', true, 1440)).toBe(PANEL_MAX_WIDTH);
    expect(keyboardDockedWidth(360, 'Enter', false, 1440)).toBeNull();
  });
});

describe('floating rect', () => {
  const room = { width: 1200, height: 800 };
  const inside = (r: { x: number; y: number; width: number; height: number }) =>
    r.x >= FLOATING_MARGIN &&
    r.y >= FLOATING_MARGIN &&
    r.x + r.width <= room.width - FLOATING_MARGIN &&
    r.y + r.height <= room.height - FLOATING_MARGIN;
  it('always stays fully inside the room', () => {
    for (const rect of [
      { x: -500, y: -500, width: 360, height: 400 },
      { x: 5000, y: 5000, width: 360, height: 400 },
      { x: 100, y: 100, width: 5000, height: 5000 },
    ])
      expect(inside(clampRect(rect, room))).toBe(true);
  });
  it('starts on the right side of the room when first undocked', () => {
    const rect = defaultFloatingRect(room);
    expect(inside(rect)).toBe(true);
    expect(rect.width).toBe(PANEL_DEFAULT_WIDTH);
    expect(rect.x + rect.width).toBeGreaterThan(room.width / 2);
  });
  it('moves and resizes without leaving the room or dropping below the minimum', () => {
    const start = { x: 600, y: 100, width: 360, height: 400 };
    expect(moveRect(start, 1000, 0, room).x).toBe(room.width - FLOATING_MARGIN - 360);
    const grown = resizeRect(start, 1000, 1000, room);
    expect(grown.x).toBe(600);
    expect(grown.x + grown.width).toBe(room.width - FLOATING_MARGIN);
    expect(grown.y + grown.height).toBe(room.height - FLOATING_MARGIN);
    const shrunk = resizeRect(start, -1000, -1000, room);
    expect(shrunk.width).toBe(PANEL_MIN_WIDTH);
    expect(shrunk.height).toBe(280);
  });
  it('fits rooms smaller than the minimum size', () => {
    const tiny = { width: 280, height: 200 };
    const rect = clampRect({ x: 0, y: 0, width: 360, height: 400 }, tiny);
    expect(rect.width).toBe(280 - FLOATING_MARGIN * 2);
    expect(rect.height).toBe(200 - FLOATING_MARGIN * 2);
  });
});

describe('drag helpers', () => {
  it('treats short presses as taps', () => {
    expect(movedPastThreshold(3, 4)).toBe(false);
    expect(movedPastThreshold(6, 6)).toBe(true);
  });
  it('maps arrow keys to steps', () => {
    expect(arrowDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -16 });
    expect(arrowDelta('ArrowRight', true)).toEqual({ dx: 64, dy: 0 });
    expect(arrowDelta('a', false)).toBeNull();
  });
  it('snaps a dropped tile to the nearest corner of its bounds', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 800 };
    expect(nearestCorner({ x: 10, y: 10, width: 100, height: 100 }, bounds)).toBe('top-left');
    expect(nearestCorner({ x: 280, y: 20, width: 100, height: 100 }, bounds)).toBe('top-right');
    expect(nearestCorner({ x: 20, y: 650, width: 100, height: 100 }, bounds)).toBe('bottom-left');
    expect(nearestCorner({ x: 260, y: 500, width: 100, height: 100 }, bounds)).toBe('bottom-right');
  });
});

describe('saved panel preference', () => {
  it('falls back to docked defaults for missing or malformed values', () => {
    for (const raw of [null, '', 'not json', '42', '{"dock":"sideways","width":"wide"}'])
      expect(parsePanelPreference(raw)).toEqual({
        dock: 'docked',
        width: PANEL_DEFAULT_WIDTH,
        rect: null,
      });
  });
  it('keeps a valid floating preference and clamps the saved width', () => {
    expect(
      parsePanelPreference(
        JSON.stringify({
          dock: 'floating',
          width: 9999,
          rect: { x: 1, y: 2, width: 300, height: 400 },
        }),
      ),
    ).toEqual({
      dock: 'floating',
      width: PANEL_MAX_WIDTH,
      rect: { x: 1, y: 2, width: 300, height: 400 },
    });
    expect(
      parsePanelPreference(JSON.stringify({ dock: 'floating', rect: { x: 1, y: 'a' } })).rect,
    ).toBeNull();
  });
});
