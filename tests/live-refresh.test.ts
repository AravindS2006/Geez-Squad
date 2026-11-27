import { describe, expect, it } from 'vitest';
import { createRefreshLoop, REFRESH_MIN_GAP_MS, type LoopTimers } from '../src/lib/live-refresh';

/** Manual clock: timers fire only when advanced. */
function clock() {
  let now = 0;
  let next = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: LoopTimers = {
    now: () => now,
    set(fn, ms) {
      const id = ++next;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(id) {
      pending.delete(id as number);
    },
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await flush();
    }
    now = end;
    await flush();
  }
  return { timers, advance };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** A poll whose fetch resolves only when told to. */
function controlledPoll(delay = 3000) {
  const calls: Array<() => void> = [];
  const poll = () =>
    new Promise<number>((resolve) => {
      calls.push(() => resolve(delay));
    });
  return { poll, calls };
}

describe('live room snapshot loop', () => {
  it('polls on the regular delay when nothing nudges it', async () => {
    const c = clock();
    let count = 0;
    const loop = createRefreshLoop(async () => (count++, 3000), c.timers);
    loop.start();
    await flush();
    expect(count).toBe(1);
    await c.advance(2999);
    expect(count).toBe(1);
    await c.advance(1);
    expect(count).toBe(2);
    loop.stop();
  });

  it('a nudge fetches early instead of waiting for the regular poll', async () => {
    const c = clock();
    let count = 0;
    const loop = createRefreshLoop(async () => (count++, 3000), c.timers);
    loop.start();
    await flush();
    await c.advance(1500);
    loop.request();
    await c.advance(0);
    expect(count).toBe(2);
    loop.stop();
  });

  it('never discards the fetch in flight; nudges during it earn one trailing fetch', async () => {
    const c = clock();
    const p = controlledPoll();
    const loop = createRefreshLoop(p.poll, c.timers);
    loop.start();
    expect(p.calls).toHaveLength(1);
    for (let i = 0; i < 20; i++) loop.request();
    expect(p.calls).toHaveLength(1);
    await c.advance(400);
    p.calls[0]();
    await flush();
    // Trailing fetch waits out the minimum gap from the previous start (0 ms).
    await c.advance(REFRESH_MIN_GAP_MS - 400 - 1);
    expect(p.calls).toHaveLength(1);
    await c.advance(1);
    expect(p.calls).toHaveLength(2);
    loop.stop();
  });

  it('caps a nudge storm at one fetch per minimum gap', async () => {
    const c = clock();
    let count = 0;
    const loop = createRefreshLoop(async () => (count++, 3000), c.timers);
    loop.start();
    await flush();
    for (let t = 0; t < 5000; t += 100) {
      loop.request();
      await c.advance(100);
    }
    expect(count).toBeLessThanOrEqual(Math.ceil(5000 / REFRESH_MIN_GAP_MS) + 1);
    expect(count).toBeGreaterThanOrEqual(5);
    loop.stop();
  });

  it('does nothing after stop, even when a fetch resolves late', async () => {
    const c = clock();
    const p = controlledPoll();
    const loop = createRefreshLoop(p.poll, c.timers);
    loop.start();
    loop.stop();
    p.calls[0]();
    await flush();
    loop.request();
    await c.advance(10_000);
    expect(p.calls).toHaveLength(1);
  });

  it('keeps polling after a fetch rejects', async () => {
    const c = clock();
    let count = 0;
    const loop = createRefreshLoop(async () => {
      count++;
      throw new Error('offline');
    }, c.timers);
    loop.start();
    await flush();
    await c.advance(REFRESH_MIN_GAP_MS);
    expect(count).toBe(2);
    loop.stop();
  });
});
