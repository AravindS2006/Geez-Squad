'use client';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { movedPastThreshold, nearestCorner, type Corner } from '@/lib/room-layout';

/**
 * Drag a floating tile and drop it in the nearest corner of its bounds. While dragging,
 * the tile follows the pointer through its own `style.transform`, written at most once
 * per animation frame, so moving it never re-renders the room or the camera analyzer.
 * React state changes twice per drag: when it starts and when it ends. On release the
 * caller stores the corner and CSS places the tile there. A press that moves less than
 * the drag threshold stays a normal tap or click on the element under it.
 *
 * Moves are tracked on `window` for the length of the press, so a fast first move that
 * leaves the tile still counts, without pointer capture re-targeting the tap's click.
 */
export function useCornerDrag({
  enabled,
  bounds,
  onDrop,
}: {
  enabled: boolean;
  /** Element whose box decides the corner, looked up from the tile at drag start. */
  bounds: (tile: HTMLElement) => Element | null;
  onDrop: (corner: Corner) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef({ bounds, onDrop });
  useEffect(() => {
    latest.current = { bounds, onDrop };
  });
  // A press still in progress when the tile unmounts stops listening.
  useEffect(() => () => cleanup.current?.(), []);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    // A new press always starts clean: an earlier drag that produced no click (touch, or
    // a release outside the tile) must not swallow this tap.
    suppressClick.current = false;
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    // Controls inside the tile keep working normally.
    if ((event.target as Element).closest('button, select, input, a, textarea')) return;
    // No text selection while dragging with a mouse; touch uses `touch-action: none`.
    if (event.pointerType === 'mouse') event.preventDefault();
    cleanup.current?.();
    const tile = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const id = event.pointerId;
    let active = false;
    let frame = 0;
    let last = { dx: 0, dy: 0 };
    const paint = () => {
      frame = 0;
      tile.style.transform = `translate(${last.dx}px, ${last.dy}px)`;
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== id) return;
      last = { dx: e.clientX - startX, dy: e.clientY - startY };
      if (!active) {
        if (!movedPastThreshold(last.dx, last.dy)) return;
        active = true;
        tile.style.transition = 'none';
        setDragging(true);
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = (e: globalThis.PointerEvent, drop: boolean) => {
      if (e.pointerId !== id) return;
      stop();
      if (!active) return;
      suppressClick.current = true;
      if (drop) {
        paint();
        const area = latest.current.bounds(tile)?.getBoundingClientRect();
        const box = tile.getBoundingClientRect();
        if (area)
          latest.current.onDrop(
            nearestCorner(
              { x: box.x, y: box.y, width: box.width, height: box.height },
              { x: area.x, y: area.y, width: area.width, height: area.height },
            ),
          );
      }
      tile.style.transform = '';
      tile.style.transition = '';
      setDragging(false);
    };
    const up = (e: globalThis.PointerEvent) => end(e, true);
    const cancel = (e: globalThis.PointerEvent) => end(e, false);
    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      cleanup.current = null;
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    cleanup.current = stop;
  }
  function onClickCapture(event: MouseEvent<HTMLElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    dragging,
    handlers: enabled ? { onPointerDown, onClickCapture } : {},
  };
}
