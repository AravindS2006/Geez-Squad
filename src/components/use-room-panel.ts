'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampDockedWidth,
  clampRect,
  defaultFloatingRect,
  PANEL_PREFERENCE_KEY,
  panelPresentation,
  parsePanelPreference,
  type PanelDock,
  type PanelPreference,
  type PanelPresentation,
  type Rect,
  type Size,
} from '@/lib/room-layout';

export type PanelTabId = 'coach' | 'chat' | 'workout' | 'people' | 'options';

/**
 * Open state, tab, dock preference and measured room size for the live room side panel.
 * The stage never reads this state for its element tree; only classes and CSS variables
 * on the shell change, so the analyzer and remote video elements are never remounted.
 */
export function useRoomPanel() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PanelTabId>('chat');
  const [preference, setPreferenceState] = useState<PanelPreference>(() =>
    parsePanelPreference(null),
  );
  const [viewport, setViewport] = useState<Size>({ width: 1440, height: 900 });
  const [room, setRoom] = useState<Size>({ width: 1440, height: 760 });

  // The saved layout is read when the panel first opens (an event, not an effect).
  const loaded = useRef(false);
  const loadPreference = () => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      setPreferenceState(parsePanelPreference(localStorage.getItem(PANEL_PREFERENCE_KEY)));
    } catch {
      // The panel works with defaults when storage is unavailable.
    }
  };

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setRoom((previous) =>
        previous.width === Math.round(width) && previous.height === Math.round(height)
          ? previous
          : { width: Math.round(width), height: Math.round(height) },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const presentation: PanelPresentation = panelPresentation(viewport, preference.dock);
  const width = clampDockedWidth(preference.width, room.width);
  const rect: Rect = clampRect(preference.rect ?? defaultFloatingRect(room), room);

  const save = useCallback((next: PanelPreference) => {
    try {
      localStorage.setItem(PANEL_PREFERENCE_KEY, JSON.stringify(next));
    } catch {
      // Layout still works for this visit without saving it.
    }
  }, []);

  /** Updates the preference; `persist` is false while a pointer drag is in progress. */
  const setPreference = useCallback(
    (update: (previous: PanelPreference) => PanelPreference, persist = true) =>
      setPreferenceState((previous) => {
        const next = update(previous);
        if (persist) save(next);
        return next;
      }),
    [save],
  );

  const rememberOpener = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('[data-room-panel]'))
      opener.current = active;
  };

  const show = useCallback((next: PanelTabId) => {
    loadPreference();
    rememberOpener();
    setTab(next);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const target = opener.current;
    opener.current = null;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }, []);

  const toggle = useCallback(
    (next: PanelTabId) => {
      if (open && tab === next) close();
      else show(next);
    },
    [open, tab, close, show],
  );

  const setDock = useCallback(
    (dock: PanelDock) =>
      setPreference((previous) => ({
        ...previous,
        dock,
        rect: dock === 'floating' ? (previous.rect ?? defaultFloatingRect(room)) : previous.rect,
      })),
    [room, setPreference],
  );

  return {
    bodyRef,
    open,
    tab,
    setTab,
    show,
    close,
    toggle,
    presentation,
    width,
    rect,
    room,
    setDock,
    setPreference,
  };
}

export type RoomPanelState = ReturnType<typeof useRoomPanel>;
