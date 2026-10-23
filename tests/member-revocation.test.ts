import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/security', () => ({ ApiError: class extends Error {} }));
const fixture = vi.hoisted(() => ({
  classSession: { findMany: vi.fn() },
  studio: { findUniqueOrThrow: vi.fn() },
  studioRoleGrant: { findMany: vi.fn() },
  studioMember: { findMany: vi.fn() },
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
