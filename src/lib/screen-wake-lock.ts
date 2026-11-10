/**
 * One shared screen wake lock for the page. Camera analysis and the live room each
 * hold it while active; the screen may sleep again once the last holder lets go.
 * Browsers drop the lock when the tab is hidden, so it is requested again on return.
 * Unsupported browsers and refused requests (for example low power mode) are silent:
 * the lock is a convenience and must never affect the camera, room or counting.
 */
type Lock = {
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};
type LockApi = { request: (type: 'screen') => Promise<Lock> };

const holders = new Set<symbol>();
let lock: Lock | null = null;
let requesting = false;

function api() {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { wakeLock?: LockApi }).wakeLock;
}
async function acquire() {
  const wakeLock = api();
  if (!wakeLock || lock || requesting || !holders.size || document.hidden) return;
  requesting = true;
  try {
    const granted = await wakeLock.request('screen');
    if (!holders.size) {
      void granted.release().catch(() => {});
      return;
    }
    lock = granted;
    granted.addEventListener('release', () => {
      if (lock === granted) lock = null;
    });
  } catch {
    /* Refused or unavailable: the screen follows the device's normal timer. */
  } finally {
    requesting = false;
  }
}
function onVisibility() {
  if (!document.hidden) void acquire();
}
/** Keeps the screen awake until the returned function is called. Safe to call twice. */
export function holdScreenAwake() {
  if (typeof document === 'undefined' || !api()) return () => {};
  const holder = Symbol('screen-awake');
  if (!holders.size) document.addEventListener('visibilitychange', onVisibility);
  holders.add(holder);
  void acquire();
  return () => {
    if (!holders.delete(holder) || holders.size) return;
    document.removeEventListener('visibilitychange', onVisibility);
    const held = lock;
    lock = null;
    void held?.release().catch(() => {});
  };
}
