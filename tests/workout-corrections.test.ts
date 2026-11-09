import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  findSet: vi.fn(),
  findCorrection: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/security', async () => {
  const { TestApiError, testSafeError } = await import('./route-mocks');
  return {
    ApiError: TestApiError,
    safeError: testSafeError,
    requireUser: async () => ({ id: 'coach' }),
    readJson: (request: Request) => request.json(),
    rateLimit: async () => undefined,
  };
});
vi.mock('@/lib/workout-history', () => ({ workoutVisibility: async () => ({}) }));
vi.mock('@/lib/db', () => ({
  db: {
    workoutSet: { findFirst: fx.findSet },
    workoutCorrection: { findUnique: fx.findCorrection },
    $transaction: fx.transaction,
  },
}));
import { POST } from '../src/app/api/workout-sets/corrections/route';

const clientId = '6f1c2b8e-7d4a-4c1e-9b3a-2f5d8e7c6a41';
const post = (body: Record<string, unknown>) =>
  POST(
    new Request('http://localhost/api/workout-sets/corrections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, setId: 'set', holdMs: 0, reason: 'Counted twice', ...body }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  fx.findSet.mockResolvedValue({ id: 'set', exercise: 'squat', activeMs: 3500, measurement: null });
  fx.findCorrection.mockResolvedValue(null);
  fx.transaction.mockImplementation(async (run: (tx: unknown) => unknown) =>
    run({ workoutCorrection: { create: fx.create }, auditEvent: { create: fx.audit } }),
  );
  fx.create.mockImplementation(async ({ data }: { data: unknown }) => data);
});
describe('workout corrections', () => {
  it('rejects counts faster than the saved-set plausibility bound', async () => {
    // 3.5 s of observed activity allows at most ten repetitions.
    expect((await post({ reps: 11 })).status).toBe(400);
    expect(fx.transaction).not.toHaveBeenCalled();
    expect((await post({ reps: 10 })).status).toBe(200);
  });
  it('returns the stored correction when a concurrent retry wins the insert', async () => {
    const stored = { id: clientId, setId: 'set', actorId: 'coach', reps: 8, holdMs: 0 };
    fx.findCorrection.mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
    fx.transaction.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));
    const response = await post({ reps: 8 });
    expect(response.status).toBe(200);
    expect((await response.json()).correction).toEqual(stored);
  });
  it('still rejects a client identity owned by another set after a conflict', async () => {
    fx.findCorrection
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: clientId, setId: 'other', actorId: 'coach' });
    fx.transaction.mockRejectedValueOnce(Object.assign(new Error('Unique'), { code: 'P2002' }));
    expect((await post({ reps: 8 })).status).toBe(409);
  });
});
