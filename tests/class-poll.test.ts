import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  permissions: vi.fn(),
  participation: vi.fn(),
  reconcile: vi.fn(),
  findClass: vi.fn(),
  presence: vi.fn(),
}));
vi.mock('next/server', async (load) => ({
  ...(await load<typeof import('next/server')>()),
  after: (task: () => unknown) => void task(),
}));
vi.mock('@/lib/class-completion', () => ({ recordClassPresence: fx.presence }));
vi.mock('@/lib/security', async () => {
  const { TestApiError, testSafeError } = await import('./route-mocks');
  return {
    ApiError: TestApiError,
    safeError: testSafeError,
    requireUser: async () => ({ id: 'trainee' }),
  };
});
vi.mock('@/lib/studio-access', () => ({ classPermissions: fx.permissions }));
vi.mock('@/lib/member-access', () => ({
  participation: fx.participation,
  reconcileClassParticipants: fx.reconcile,
}));
vi.mock('@/lib/db', () => ({
  db: {
    classSession: { findUnique: fx.findClass },
    user: { findUnique: async () => ({ name: 'Coach' }) },
    enrollment: {
      findMany: async () => [{ userId: 'trainee', user: { id: 'trainee', name: 'T' } }],
    },
    message: { findMany: async () => [] },
  },
}));
import { GET } from '../src/app/api/classes/[id]/route';

beforeEach(() => {
  vi.resetAllMocks();
  fx.findClass.mockResolvedValue({
    id: 'class',
    status: 'live',
    exercise: 'squat',
    planId: null,
    workoutSnapshot: [],
    studio: { id: 'studio', ownerId: 'owner' },
    _count: { enrollments: 1 },
  });
  fx.permissions.mockResolvedValue({ canManage: false, hostId: 'coach' });
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
  expect((await poll()).status).toBe(200);
  expect((await poll()).status).toBe(200);
  expect(fx.permissions).toHaveBeenCalledTimes(2);
  expect(fx.participation).toHaveBeenCalledTimes(2);
  expect(fx.reconcile).toHaveBeenCalledWith('class', 'studio', 'trainee');
});
it('revokes HTTP access on the next poll even when the sweep is throttled', async () => {
  fx.participation.mockResolvedValue({ allowed: false, reason: 'Membership expired.' });
  const body = await (await poll()).json();
  expect(body.participationAllowed).toBe(false);
});
it('hands the class and the caller role to the lifecycle hook after authorization', async () => {
  expect((await poll()).status).toBe(200);
  expect(fx.presence).toHaveBeenCalledWith(expect.objectContaining({ id: 'class' }), false);
  fx.permissions.mockResolvedValue({ canManage: true, hostId: 'coach' });
  expect((await poll()).status).toBe(200);
  expect(fx.presence).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'class' }), true);
});
