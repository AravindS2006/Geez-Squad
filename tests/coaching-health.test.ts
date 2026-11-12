import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({
  findClass: vi.fn(),
  findEnrollment: vi.fn(),
  participation: vi.fn(),
  studioAccess: vi.fn(),
  log: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock('@/lib/security', async () => {
  const { TestApiError, testSafeError } = await import('./route-mocks');
  return {
    ApiError: TestApiError,
    safeError: testSafeError,
    requireUser: async () => ({ id: 'session-user' }),
    readJson: (request: Request) => request.json(),
    rateLimit: fx.rateLimit,
  };
});
vi.mock('@/lib/logger', () => ({ logEvent: fx.log }));
vi.mock('@/lib/request-log', () => ({
  loggedRoute: (_name: string, handler: unknown) => handler,
}));
vi.mock('../src/lib/member-access', () => ({ participation: fx.participation }));
vi.mock('../src/lib/studio-access', () => ({ studioAccess: fx.studioAccess }));
const store = {
  classSession: { findUnique: fx.findClass },
  enrollment: { findUnique: fx.findEnrollment },
};
vi.mock('@/lib/db', () => ({
  db: { $transaction: (run: (tx: typeof store) => unknown) => run(store) },
}));
import { POST } from '../src/app/api/coaching-health/route';
import { healthBody } from '../src/lib/coaching-health';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/coaching-health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  fx.findClass.mockResolvedValue({ id: 'class-1', studioId: 'studio-1' });
  fx.findEnrollment.mockResolvedValue(null);
  fx.participation.mockResolvedValue({ allowed: true, reason: '' });
  fx.studioAccess.mockResolvedValue(null);
});
const logged = () => fx.log.mock.calls.at(-1)![2];

describe('coaching health events', () => {
  it('builds a bounded client body with the class id', () => {
    expect(healthBody('inference_slow', { durationMs: 70_000.4, classId: 'class-1' })).toEqual({
      event: 'inference_slow',
      durationMs: 60_000,
      classId: 'class-1',
    });
    expect(healthBody('save_failed', { classId: null })).toEqual({ event: 'save_failed' });
    expect(healthBody('save_failed', { classId: 'x'.repeat(101) })).toEqual({
      event: 'save_failed',
    });
  });

  it('logs the session user, studio and class for an enrolled, participating trainee', async () => {
    fx.findEnrollment.mockResolvedValue({ userId: 'session-user' });
    const response = await post({ event: 'media_join_failed', classId: 'class-1' });
    expect(response.status).toBe(200);
    expect(fx.findEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classId_userId: { classId: 'class-1', userId: 'session-user' } },
      }),
    );
    expect(logged()).toMatchObject({
      code: 'media_join_failed',
      actorId: 'session-user',
      studioId: 'studio-1',
      targetId: 'class-1',
    });
  });

  it('logs studio and class for a coach of that studio', async () => {
    fx.studioAccess.mockResolvedValue({ studio: { id: 'studio-1' }, admin: false, coach: true });
    await post({ event: 'stale_summary', classId: 'class-1' });
    expect(fx.studioAccess).toHaveBeenCalledWith('session-user', 'studio-1', store);
    expect(logged()).toMatchObject({ studioId: 'studio-1', targetId: 'class-1' });
  });

  it('drops ids the caller is not authorized for, but still records the event', async () => {
    // Enrolled but membership lapsed, and only a trainee of the studio.
    fx.findEnrollment.mockResolvedValue({ userId: 'session-user' });
    fx.participation.mockResolvedValue({ allowed: false, reason: 'expired' });
    fx.studioAccess.mockResolvedValue({ studio: { id: 'studio-1' }, admin: false, coach: false });
    await post({ event: 'tracking_low', classId: 'class-1' });
    expect(logged()).toMatchObject({ code: 'tracking_low', actorId: 'session-user' });
    expect(logged().studioId).toBeUndefined();
    expect(logged().targetId).toBeUndefined();
  });

  it('drops an unknown class id and never trusts client-sent studio or user ids', async () => {
    fx.findClass.mockResolvedValue(null);
    await post({ event: 'save_failed', classId: 'someone-elses' });
    expect(logged().targetId).toBeUndefined();
    expect((await post({ event: 'save_failed', studioId: 'studio-1' })).status).not.toBe(200);
    expect((await post({ event: 'save_failed', userId: 'other' })).status).not.toBe(200);
  });

  it('rate limits per session user', async () => {
    await post({ event: 'save_failed' });
    expect(fx.rateLimit).toHaveBeenCalledWith('session-user', 'coaching-health', 12);
    expect(fx.findClass).not.toHaveBeenCalled();
  });
});
