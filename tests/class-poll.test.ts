import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  grants: vi.fn(),
  participation: vi.fn(),
  reconcile: vi.fn(),
  findClass: vi.fn(),
  enrollments: vi.fn(),
  deferred: [] as (() => unknown)[],
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    fx.deferred.push(task);
  },
}));
vi.mock('@/lib/security', async () => {
  const { TestApiError, testSafeError } = await import('./route-mocks');
  return {
    ApiError: TestApiError,
    safeError: testSafeError,
    requireSessionUser: async () => ({ id: 'trainee', name: 'T' }),
  };
});
vi.mock('@/lib/studio-access', async (original) => ({
  ...(await original<typeof import('../src/lib/studio-access')>()),
  classAccessGrants: fx.grants,
}));
vi.mock('@/lib/member-access', () => ({
  participation: fx.participation,
  reconcileClassParticipants: fx.reconcile,
}));
vi.mock('@/lib/db', () => ({
  db: {
    classSession: { findUnique: fx.findClass },
    user: {
      findMany: async () => [
        { id: 'coach', name: 'Coach' },
        { id: 'trainee', name: 'T' },
      ],
    },
    enrollment: { findMany: fx.enrollments },
    message: { findMany: async () => [] },
    workoutPlan: { findUnique: vi.fn() },
  },
}));
import { GET } from '../src/app/api/classes/[id]/route';

beforeEach(() => {
  vi.resetAllMocks();
  fx.deferred.length = 0;
  fx.findClass.mockResolvedValue({
    id: 'class',
    studioId: 'studio',
    hostId: 'coach',
    status: 'live',
    exercise: 'squat',
    planId: null,
    workoutSnapshot: [],
    studio: { id: 'studio', ownerId: 'owner' },
    _count: { enrollments: 1 },
  });
  fx.enrollments.mockResolvedValue([{ userId: 'trainee' }]);
  fx.grants.mockResolvedValue([{ userId: 'trainee', role: 'trainee', status: 'active' }]);
  fx.participation.mockResolvedValue({ allowed: true, reason: '' });
});
const poll = () =>
  GET(
    new Request('http://localhost/api/classes/class', { headers: { 'X-Coaching-Client': '2' } }),
    {
      params: Promise.resolve({ id: 'class' }),
    },
  );
it('authorizes every poll and delegates LiveKit sweeps to the per-class throttle', async () => {
  const first = await poll();
  expect(first.status).toBe(200);
  expect((await first.json()).coachName).toBe('Coach');
  expect((await poll()).status).toBe(200);
  expect(fx.grants).toHaveBeenCalledTimes(2);
  expect(fx.participation).toHaveBeenCalledTimes(2);
  // The trainee's own grant is reused rather than read again.
  expect(fx.participation.mock.calls[0][4]).toEqual({
    userId: 'trainee',
    role: 'trainee',
    status: 'active',
  });
  // The sweep is scheduled after the response, never awaited by the poll.
  expect(fx.reconcile).not.toHaveBeenCalled();
  expect(fx.deferred).toHaveLength(2);
  await fx.deferred[0]();
  expect(fx.reconcile).toHaveBeenCalledWith('class', 'studio', 'trainee');
});
it('answers the poll while a slow LiveKit sweep is still pending', async () => {
  fx.reconcile.mockReturnValue(new Promise(() => {}));
  expect((await poll()).status).toBe(200);
  void fx.deferred[0]();
});
it('revokes HTTP access on the next poll even when the sweep is throttled', async () => {
  fx.participation.mockResolvedValue({ allowed: false, reason: 'Membership expired.' });
  const body = await (await poll()).json();
  expect(body.participationAllowed).toBe(false);
});
it('keeps an unenrolled non-manager at 404 without scheduling a sweep', async () => {
  fx.enrollments.mockResolvedValueOnce([]);
  expect((await poll()).status).toBe(404);
  expect(fx.deferred).toHaveLength(0);
});
