import { useEffect } from 'react';
import { holdScreenAwake } from '@/lib/screen-wake-lock';

/** Holds the shared screen wake lock while `active` is true. */
export function useScreenAwake(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return holdScreenAwake();
  }, [active]);
}
