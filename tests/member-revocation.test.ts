import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({ ApiError: class extends Error {} }));
const fixture = vi.hoisted(() => ({
  classSession: { findMany: vi.fn() },
  studio: { findUniqueOrThrow: vi.fn() },
  studioRoleGrant: { findMany: vi.fn() },
  studioMember: { findMany: vi.fn() },
  rateLimit: { create: vi.fn() },
  claims: new Set<string>(),
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: fixture }));
vi.mock('livekit-server-sdk', () => ({
  TrackSource: { SCREEN_SHARE: 3 },
  RoomServiceClient: class {
    listParticipants = fixture.list;
    removeParticipant = fixture.remove;
  },
}));
import { revokeIneligibleParticipants } from '../src/lib/member-access';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('LIVEKIT_URL', 'wss://example.test');
  vi.stubEnv('LIVEKIT_API_KEY', 'test');
  vi.stubEnv('LIVEKIT_API_SECRET', 'test');
  fixture.classSession.findMany.mockResolvedValue([
    {
      id: 'session',
      studioId: 'studio',
      hostId: 'host',
      videoRoomName: 'test-room',
      enrollments: ['host', 'trainee', 'former-host', 'expired'].map((userId) => ({ userId })),
    },
  ]);
  fixture.studio.findUniqueOrThrow.mockResolvedValue({ ownerId: 'owner' });
  fixture.studioRoleGrant.findMany.mockResolvedValue([{ userId: 'host', role: 'coach' }]);
  fixture.studioMember.findMany.mockResolvedValue([
    { userId: 'trainee' },
    { userId: 'former-host' },
  ]);
  fixture.remove.mockResolvedValue(undefined);
  // The shared RateLimit table: a second insert of the same key is a unique conflict.
  fixture.claims.clear();
  fixture.rateLimit.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
    if (fixture.claims.has(data.key)) throw Object.assign(new Error('Unique'), { code: 'P2002' });
    fixture.claims.add(data.key);
    return data;
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('live revocation reconciliation', () => {
  it('batches eligibility and removes stale presenter capabilities without blocking personal member benefits', async () => {
    fixture.list.mockResolvedValue([
      { identity: 'host', permission: { canPublishSources: [1, 2, 3] } },
      { identity: 'trainee', permission: { canPublishSources: [1, 2] } },
      { identity: 'former-host', permission: { canPublishSources: [1, 2, 3] } },
      { identity: 'expired', permission: { canPublishSources: [1, 2] } },
      { identity: 'unknown', permission: { canPublishSources: [1, 2] } },
    ]);
    await revokeIneligibleParticipants('studio', 'trainee');
    expect(fixture.remove.mock.calls.map((c) => c[1]).sort()).toEqual([
      'expired',
      'former-host',
      'unknown',
    ]);
    expect(fixture.studioMember.findMany).toHaveBeenCalledTimes(1);
    expect(fixture.studioRoleGrant.findMany).toHaveBeenCalledTimes(1);
    expect(fixture.classSession.findMany.mock.calls[0][0].where.enrollments).toEqual({
      some: { userId: 'trainee' },
    });
    fixture.remove.mockClear();
    fixture.list.mockResolvedValue([
      { identity: 'former-host', permission: { canPublishSources: [1, 2] } },
    ]);
    await revokeIneligibleParticipants('studio');
    expect(fixture.remove.mock.calls.some((c) => c[1] === 'former-host')).toBe(false);
  });
  it('retries a failed former-host removal on the next poll', async () => {
    fixture.list.mockResolvedValue([
      { identity: 'former-host', permission: { canPublishSources: [1, 2, 3] } },
    ]);
    fixture.remove.mockRejectedValueOnce(new Error('Temporary RTC failure'));
    await revokeIneligibleParticipants('studio');
    await revokeIneligibleParticipants('studio');
    expect(fixture.remove.mock.calls.filter((c) => c[1] === 'former-host')).toHaveLength(2);
  });
});
describe('class poll revocation throttle', () => {
  it('sweeps LiveKit at most once per class and scope within the interval', async () => {
    const {
      reconcileClassParticipants,
      resetClassRevocationThrottle,
      CLASS_REVOCATION_INTERVAL_MS,
    } = await import('../src/lib/member-access');
    resetClassRevocationThrottle();
    fixture.list.mockResolvedValue([]);
    const start = 1_000_000;
    expect(await reconcileClassParticipants('class', 'studio', undefined, start)).toBe(true);
    expect(await reconcileClassParticipants('class', 'studio', undefined, start + 3000)).toBe(
      false,
    );
    // A trainee's own check and another class are tracked separately.
    expect(await reconcileClassParticipants('class', 'studio', 'trainee', start + 3000)).toBe(true);
    expect(await reconcileClassParticipants('other', 'studio', undefined, start + 3000)).toBe(true);
    expect(fixture.list).toHaveBeenCalledTimes(3);
    expect(
      await reconcileClassParticipants(
        'class',
        'studio',
        undefined,
        start + CLASS_REVOCATION_INTERVAL_MS,
      ),
    ).toBe(true);
    expect(fixture.list).toHaveBeenCalledTimes(4);
  });
  it('lets one server instance sweep per window even when another instance has no memory of it', async () => {
    const { reconcileClassParticipants, resetClassRevocationThrottle } =
      await import('../src/lib/member-access');
    resetClassRevocationThrottle();
    fixture.list.mockResolvedValue([]);
    const start = 2_000_000;
    expect(await reconcileClassParticipants('class', 'studio', undefined, start)).toBe(true);
    // A fresh instance (empty in-memory throttle) in the same window sees the claim row.
    resetClassRevocationThrottle();
    expect(await reconcileClassParticipants('class', 'studio', undefined, start + 1000)).toBe(
      false,
    );
    expect(fixture.list).toHaveBeenCalledTimes(1);
    expect(fixture.rateLimit.create.mock.calls[0][0].data.key).toMatch(/^sweep:class:\*:/);
  });
  it('still sweeps when the claim cannot be written, and skips everything without LiveKit', async () => {
    const { reconcileClassParticipants, resetClassRevocationThrottle } =
      await import('../src/lib/member-access');
    resetClassRevocationThrottle();
    fixture.list.mockResolvedValue([]);
    fixture.rateLimit.create.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await reconcileClassParticipants('class', 'studio', undefined, 3_000_000)).toBe(true);
    expect(fixture.list).toHaveBeenCalledTimes(1);
    vi.stubEnv('LIVEKIT_URL', '');
    resetClassRevocationThrottle();
    fixture.rateLimit.create.mockClear();
    expect(await reconcileClassParticipants('class', 'studio', undefined, 4_000_000)).toBe(false);
    expect(fixture.rateLimit.create).not.toHaveBeenCalled();
  });
});
