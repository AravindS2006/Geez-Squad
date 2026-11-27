/**
 * The live room's HTTP snapshot loop (`GET /api/classes/[id]`), with LiveKit nudges.
 *
 * A nudge (a metric-free data packet sent after a control change, message or trainee
 * summary) asks for an early refetch. Nudges never restart the loop or discard a fetch
 * already in flight: one that arrives mid-fetch earns a single trailing fetch, and
 * fetches start at most once per `REFRESH_MIN_GAP_MS`, so a class full of trainees
 * cannot turn the coach view into a request storm or starve it of results.
 */
export const REFRESH_MIN_GAP_MS = 1000;

export type LoopTimers = {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
};

const browserTimers: LoopTimers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * `poll` performs one fetch and resolves the delay until the next regular fetch.
 * It must handle its own errors; a rejection is treated as "retry after the gap".
 */
export function createRefreshLoop(
  poll: () => Promise<number>,
  timers: LoopTimers = browserTimers,
  minGapMs = REFRESH_MIN_GAP_MS,
) {
  let timer: unknown = null;
  let dueAt = Number.POSITIVE_INFINITY;
  let startedAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;
  let requested = false;
  let stopped = false;

  function schedule(ms: number) {
    if (timer !== null) timers.clear(timer);
    dueAt = timers.now() + ms;
    timer = timers.set(() => {
      timer = null;
      dueAt = Number.POSITIVE_INFINITY;
      void run();
    }, ms);
  }
  const gapLeft = () => Math.max(0, startedAt + minGapMs - timers.now());

  async function run() {
    if (stopped) return;
    inFlight = true;
    requested = false;
    startedAt = timers.now();
    let delay = minGapMs;
    try {
      delay = await poll();
    } catch {
      /* The poll reports its own errors; keep the loop alive. */
    }
    inFlight = false;
    if (stopped) return;
    schedule(requested ? gapLeft() : delay);
  }

  return {
    start() {
      if (!stopped && !inFlight && timer === null) void run();
    },
    /** Fetch soon: now, after the minimum gap, or once the fetch in flight ends. */
    request() {
      if (stopped) return;
      if (inFlight) {
        requested = true;
        return;
      }
      const ms = gapLeft();
      if (timers.now() + ms < dueAt) schedule(ms);
    },
    stop() {
      stopped = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}
