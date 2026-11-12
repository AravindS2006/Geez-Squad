import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  upsert: vi.fn(),
  counts: new Map<string, number>(),
  getSession: vi.fn(),
  findUser: vi.fn(),
  policy: { requireVerification: false },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: fx.getSession } },
  emailPolicy: fx.policy,
}));
vi.mock('@/lib/db', () => ({
  db: { rateLimit: { upsert: fx.upsert }, user: { findUnique: fx.findUser } },
}));
import {
  FixedWindows,
  METRIC_STEADY_INTERVAL_MS,
  fixedWindow,
  metricNeedsSharedLimit,
} from '../src/lib/rate-window';
import {
  localRateLimit,
  rateLimit,
  requireSessionUser,
  requireUser,
  resetRateWindows,
} from '../src/lib/security';

beforeEach(() => {
  vi.resetAllMocks();
  resetRateWindows();
  fx.counts.clear();
  fx.policy.requireVerification = false;
  fx.upsert.mockImplementation(async ({ where }: { where: { key: string } }) => {
    const count = (fx.counts.get(where.key) ?? 0) + 1;
    fx.counts.set(where.key, count);
    return { key: where.key, count };
  });
});

describe('fixed windows', () => {
  it('counts per window and forgets a window once it rolls', () => {
    const windows = new FixedWindows();
    const { until } = fixedWindow(1_000, 60_000);
    expect(until).toBe(60_000);
    expect(windows.hit('k', until, 1_000)).toBe(1);
    expect(windows.hit('k', until, 2_000)).toBe(2);
    expect(windows.hit('k', 120_000, 61_000)).toBe(1);
    windows.block('b', until, 1_000);
    expect(windows.blocked('b', 59_999)).toBe(true);
    expect(windows.blocked('b', 60_000)).toBe(false);
  });
  it('stays bounded under many keys', () => {
    const windows = new FixedWindows(10);
    for (let i = 0; i < 100; i++) windows.hit(`k${i}`, 60_000, 1_000);
    expect(windows.hit('k99', 60_000, 1_000)).toBe(2);
    expect(windows.hit('k0', 60_000, 1_000)).toBe(1);
  });
});

describe('metric heartbeat limiting', () => {
  it('charges the shared limiter only for first and faster-than-steady summaries', () => {
    const now = 10_000_000;
    expect(metricNeedsSharedLimit(undefined, now)).toBe(true);
    expect(metricNeedsSharedLimit(new Date(now - 500), now)).toBe(true);
    expect(metricNeedsSharedLimit(new Date(now - METRIC_STEADY_INTERVAL_MS), now)).toBe(false);
    // The live room's own cadence (2.8 s changed, 9 s heartbeat) never writes a row.
    expect(metricNeedsSharedLimit(new Date(now - 2_800), now)).toBe(false);
    expect(metricNeedsSharedLimit(new Date(now - 9_000), now)).toBe(false);
  });
});

describe('shared rate limit', () => {
  it('keeps the shared limit and stops writing once this instance saw it exceeded', async () => {
    for (let i = 0; i < 3; i++) await rateLimit('user', 'command', 3);
    await expect(rateLimit('user', 'command', 3)).rejects.toMatchObject({ status: 429 });
    expect(fx.upsert).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 20; i++)
      await expect(rateLimit('user', 'command', 3)).rejects.toMatchObject({ status: 429 });
    expect(fx.upsert).toHaveBeenCalledTimes(4);
    // Other users and actions are unaffected; the row key format is unchanged.
    await rateLimit('other', 'command', 3);
    expect(fx.upsert.mock.calls.at(-1)![0].where.key).toMatch(/^app:command:other:\d+$/);
  });
  it('writes through a transaction client when given one', async () => {
    const tx = { rateLimit: { upsert: vi.fn(async () => ({ count: 1 })) } };
    await rateLimit('user', 'metrics', 30, tx as never);
    expect(tx.rateLimit.upsert).toHaveBeenCalledTimes(1);
    expect(fx.upsert).not.toHaveBeenCalled();
  });
  it('limits locally without any database write', () => {
    for (let i = 0; i < 30; i++) localRateLimit('user', 'metrics', 30);
    expect(() => localRateLimit('user', 'metrics', 30)).toThrow(
      expect.objectContaining({ status: 429 }),
    );
    expect(fx.upsert).not.toHaveBeenCalled();
  });
});

describe('session identity', () => {
  const session = { user: { id: 'u1', name: 'Cached', emailVerified: false } };
  it('uses the cached session identity without a user read', async () => {
    fx.getSession.mockResolvedValue(session);
    expect(await requireSessionUser()).toEqual({ id: 'u1', name: 'Cached' });
    expect(fx.findUser).not.toHaveBeenCalled();
  });
  it('lets the database decide when a cached session looks unverified', async () => {
    fx.policy.requireVerification = true;
    fx.getSession.mockResolvedValue(session);
    fx.findUser.mockResolvedValue({ id: 'u1', name: 'Fresh', emailVerified: true });
    expect(await requireSessionUser()).toMatchObject({ id: 'u1', name: 'Fresh' });
    fx.findUser.mockResolvedValue({ id: 'u1', emailVerified: false });
    await expect(requireSessionUser()).rejects.toMatchObject({ status: 403 });
  });
  it('bypasses the cookie cache only when asked', async () => {
    fx.getSession.mockResolvedValue(session);
    fx.findUser.mockResolvedValue({ id: 'u1', emailVerified: true });
    await requireUser();
    expect(fx.getSession.mock.calls[0][0].query).toBeUndefined();
    await requireUser({ freshSession: true });
    expect(fx.getSession.mock.calls[1][0].query).toEqual({ disableCookieCache: true });
    fx.getSession.mockResolvedValue(null);
    await expect(requireSessionUser()).rejects.toMatchObject({ status: 401 });
  });
});
