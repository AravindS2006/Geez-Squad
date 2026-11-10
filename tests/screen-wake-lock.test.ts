import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdScreenAwake } from '../src/lib/screen-wake-lock';

afterEach(() => vi.unstubAllGlobals());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function browser(options: { refuse?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const page = {
    hidden: false,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const locks: { release: ReturnType<typeof vi.fn>; drop: () => void }[] = [];
  const request = vi.fn(async () => {
    if (options.refuse) throw new DOMException('Low power mode', 'NotAllowedError');
    let released: () => void = () => {};
    const lock = {
      release: vi.fn(async () => released()),
      addEventListener: (_type: string, listener: () => void) => {
        released = listener;
      },
      drop: () => released(),
    };
    locks.push(lock);
    return lock;
  });
  vi.stubGlobal('document', page);
  vi.stubGlobal('navigator', { wakeLock: { request } });
  return {
    request,
    locks,
    listeners,
    setHidden(hidden: boolean) {
      page.hidden = hidden;
      // The browser releases a screen lock itself when the page is hidden.
      if (hidden) locks.at(-1)?.drop();
      listeners.forEach((listener) => listener());
    },
  };
}
describe('screen wake lock', () => {
  it('requests a screen lock while held and releases it afterwards', async () => {
    const page = browser();
    const release = holdScreenAwake();
    await settle();
    expect(page.request).toHaveBeenCalledExactlyOnceWith('screen');
    release();
    release();
    expect(page.locks[0].release).toHaveBeenCalledTimes(1);
    expect(page.listeners.size).toBe(0);
  });
  it('shares one lock between holders until the last one lets go', async () => {
    const page = browser();
    const analysis = holdScreenAwake();
    const room = holdScreenAwake();
    await settle();
    expect(page.request).toHaveBeenCalledTimes(1);
    analysis();
    expect(page.locks[0].release).not.toHaveBeenCalled();
    room();
    expect(page.locks[0].release).toHaveBeenCalledTimes(1);
  });
  it('requests again when a hidden page becomes visible and is still held', async () => {
    const page = browser();
    const release = holdScreenAwake();
    await settle();
    page.setHidden(true);
    await settle();
    expect(page.request).toHaveBeenCalledTimes(1);
    page.setHidden(false);
    await settle();
    expect(page.request).toHaveBeenCalledTimes(2);
    release();
    page.setHidden(true);
    page.setHidden(false);
    await settle();
    expect(page.request).toHaveBeenCalledTimes(2);
  });
  it('waits for a visible page before the first request', async () => {
    const page = browser();
    page.setHidden(true);
    const release = holdScreenAwake();
    await settle();
    expect(page.request).not.toHaveBeenCalled();
    page.setHidden(false);
    await settle();
    expect(page.request).toHaveBeenCalledTimes(1);
    release();
  });
  it('releases a lock granted after the holder already let go', async () => {
    const page = browser();
    holdScreenAwake()();
    await settle();
    expect(page.locks[0].release).toHaveBeenCalledTimes(1);
  });
  it('stays silent when the request is refused or the API is missing', async () => {
    const page = browser({ refuse: true });
    const release = holdScreenAwake();
    await settle();
    expect(page.request).toHaveBeenCalledTimes(1);
    expect(release).not.toThrow();
    vi.stubGlobal('navigator', {});
    expect(holdScreenAwake()).not.toThrow();
  });
});
