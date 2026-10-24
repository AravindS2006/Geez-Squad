'use client';
import { useEffect, useRef, type RefObject } from 'react';
/** Position the coach against the actual preview, including controls above it. */
export function useCameraLayout(
  view: RefObject<HTMLDivElement | null>,
  onBounds?: (height: number, top: number) => void,
) {
  const size = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const node = view.current;
    if (!node) return;
    const layout = node.closest('.trainee-video-layout');
    const update = () => {
      const bounds = node.getBoundingClientRect();
      size.current = { width: bounds.width, height: bounds.height };
      onBounds?.(bounds.height, layout ? bounds.top - layout.getBoundingClientRect().top : 0);
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (layout) observer.observe(layout);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [view, onBounds]);
  return size;
}
