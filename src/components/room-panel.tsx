'use client';
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { GripHorizontal, MoveDiagonal2, PanelRight, PictureInPicture2, X } from 'lucide-react';
import {
  arrowDelta,
  clampDockedWidth,
  keyboardDockedWidth,
  maxDockedWidth,
  moveRect,
  PANEL_MIN_WIDTH,
  resizeRect,
} from '@/lib/room-layout';
import type { PanelTabId, RoomPanelState } from './use-room-panel';
import styles from './room-panel.module.css';

export type RoomPanelTab = {
  id: PanelTabId;
  label: string;
  /** A count shown after the label (for example unread chat), not part of the name. */
  badge?: number;
  content: ReactNode;
};

/**
 * One side panel for the live room's secondary tools. Desktop: docked beside the stage
 * (resizable) or floating over it (movable, resizable). Tablets and short landscape: a
 * side sheet. Phones: a bottom sheet. Rendered as a sibling after the stage so opening,
 * docking or resizing it never changes the stage's element tree.
 */
export function RoomPanel({ state, tabs }: { state: RoomPanelState; tabs: RoomPanelTab[] }) {
  const { presentation, width, rect, room, tab, setTab, close, setDock, setPreference } = state;
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const baseId = useId();
  const tabRefs = useRef(new Map<PanelTabId, HTMLButtonElement>());
  const asideRef = useRef<HTMLElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  // A pointer drag writes straight to the panel (or the shell's width variable) once per
  // frame and commits to React state on release, so dragging never re-renders the room
  // or the camera analyzer on every pointer move.
  const drag = useRef<{
    kind: 'width' | 'move' | 'resize';
    x: number;
    y: number;
    width: number;
    rect: typeof rect;
    nextWidth: number;
    nextRect: typeof rect;
    frame: number;
  } | null>(null);

  // Opening the panel moves focus into it, on the selected tab.
  useEffect(() => {
    tabRefs.current.get(active.id)?.focus({ preventScroll: true });
    // Only on mount: switching tabs keeps focus where the user put it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docked = presentation === 'docked';
  const floating = presentation === 'floating';

  function paint() {
    const d = drag.current;
    const aside = asideRef.current;
    if (!d || !aside) return;
    d.frame = 0;
    if (d.kind === 'width') {
      aside.parentElement?.style.setProperty('--room-panel-width', `${d.nextWidth}px`);
      separatorRef.current?.setAttribute('aria-valuenow', String(d.nextWidth));
    } else {
      aside.style.left = `${d.nextRect.x}px`;
      aside.style.top = `${d.nextRect.y}px`;
      aside.style.width = `${d.nextRect.width}px`;
      aside.style.height = `${d.nextRect.height}px`;
    }
  }
  function startDrag(kind: 'width' | 'move' | 'resize', event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (kind === 'move' && (event.target as Element).closest('button:not([data-drag-handle])'))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      width,
      rect,
      nextWidth: width,
      nextRect: rect,
      frame: 0,
    };
    document.documentElement.dataset.roomDragging = kind === 'width' ? 'col' : 'move';
  }
  function onDrag(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (d.kind === 'width') d.nextWidth = clampDockedWidth(d.width - dx, room.width);
    else if (d.kind === 'move') d.nextRect = moveRect(d.rect, dx, dy, room);
    else d.nextRect = resizeRect(d.rect, dx, dy, room);
    if (!d.frame) d.frame = requestAnimationFrame(paint);
  }
  function endDrag(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    drag.current = null;
    delete document.documentElement.dataset.roomDragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    // Commit and save the final size or position once.
    if (d.kind === 'width') setPreference((p) => ({ ...p, width: d.nextWidth }));
    else setPreference((p) => ({ ...p, rect: d.nextRect }));
  }

  function onSeparatorKey(event: KeyboardEvent<HTMLDivElement>) {
    const next = keyboardDockedWidth(width, event.key, event.shiftKey, room.width);
    if (next === null) return;
    event.preventDefault();
    setPreference((p) => ({ ...p, width: next }));
  }
  function onRectKey(kind: 'move' | 'resize', event: KeyboardEvent<HTMLButtonElement>) {
    const delta = arrowDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    setPreference((p) => ({
      ...p,
      rect:
        kind === 'move'
          ? moveRect(rect, delta.dx, delta.dy, room)
          : resizeRect(rect, delta.dx, delta.dy, room),
    }));
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current.get(tabs[next].id)?.focus();
  }

  return (
    <aside
      ref={asideRef}
      id="room-panel"
      data-room-panel
      className={styles.panel}
      data-presentation={presentation}
      aria-label={`${active.label} panel`}
      style={
        floating ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : undefined
      }
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
    >
      {docked && (
        <div
          ref={separatorRef}
          className={styles.separator}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={maxDockedWidth(room.width)}
          aria-valuenow={width}
          tabIndex={0}
          onKeyDown={onSeparatorKey}
          onPointerDown={(event) => startDrag('width', event)}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
      {presentation === 'sheet' && <span className={styles.grabber} aria-hidden="true" />}
      <div
        className={styles.header}
        data-movable={floating || undefined}
        onPointerDown={floating ? (event) => startDrag('move', event) : undefined}
        onPointerMove={floating ? onDrag : undefined}
        onPointerUp={floating ? endDrag : undefined}
        onPointerCancel={floating ? endDrag : undefined}
      >
        <h2 className={styles.title}>{active.label}</h2>
        <div className={styles.actions}>
          {floating && (
            <button
              type="button"
              data-drag-handle
              className={styles.iconButton}
              aria-label="Move panel"
              title="Drag, or use the arrow keys, to move the panel"
              onKeyDown={(event) => onRectKey('move', event)}
            >
              <GripHorizontal size={18} aria-hidden="true" />
            </button>
          )}
          {(docked || floating) && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={docked ? 'Undock panel' : 'Dock panel'}
              title={docked ? 'Float the panel over the video' : 'Dock the panel beside the video'}
              onClick={() => setDock(docked ? 'floating' : 'docked')}
            >
              {docked ? (
                <PictureInPicture2 size={18} aria-hidden="true" />
              ) : (
                <PanelRight size={18} aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close panel"
            title="Close (Esc)"
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Room tools">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            ref={(node) => {
              if (node) tabRefs.current.set(t.id, node);
              else tabRefs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            className={styles.tab}
            aria-selected={t.id === active.id}
            aria-controls={t.id === active.id ? `${baseId}-body` : undefined}
            tabIndex={t.id === active.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {t.label}
            {t.badge ? <span className={styles.badge}>{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-body`}
        className={styles.body}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
      >
        {active.content}
      </div>
      {floating && (
        <button
          type="button"
          className={styles.resize}
          aria-label="Resize panel"
          title="Drag, or use the arrow keys, to resize the panel"
          onKeyDown={(event) => onRectKey('resize', event)}
          onPointerDown={(event) => startDrag('resize', event)}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <MoveDiagonal2 size={16} aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}
