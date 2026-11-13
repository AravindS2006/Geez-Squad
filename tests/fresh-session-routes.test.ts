/**
 * Sensitive routes must not accept a session from the session cookie cache: a session
 * revoked on another device has to stop working immediately there, not after
 * `SESSION_COOKIE_CACHE_SECONDS`. Uses the real `requireUser`; only Better Auth's
 * `getSession` is observed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const fx = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: fx.getSession } },
  emailPolicy: { requireVerification: false },
}));
// Any database access would be a bug: authentication fails first in every case below.
vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error('Database touched before authentication.');
      },
    },
  ),
  databaseProvider: () => 'sqlite',
  isSqliteDatabase: () => true,
}));

type Handler = (request: Request, context?: unknown) => Promise<Response>;
const post = (path: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: '{}',
  });
const get = (path: string) => new Request(`http://localhost:3000${path}`);

const sensitive: [string, () => Promise<Handler>, Request][] = [
  [
    'account deletion',
    async () => (await import('../src/app/api/account/route')).POST,
    post('/api/account'),
  ],
  [
    'billing',
    async () => (await import('../src/app/api/billing/route')).POST,
    post('/api/billing'),
  ],
  [
    'data export',
    async () => (await import('../src/app/api/export/route')).GET as Handler,
    get('/api/export'),
  ],
  [
    'video token',
    async () => (await import('../src/app/api/video/token/route')).POST,
    post('/api/video/token'),
  ],
  [
    'workspace commands (profile, invitations, client removal, roles)',
    async () => (await import('../src/app/api/command/route')).POST,
    post('/api/command'),
  ],
  [
    'studio team roles',
    async () => (await import('../src/app/api/studio-team/route')).POST,
    post('/api/studio-team'),
  ],
  [
    'studio team requests',
    async () => (await import('../src/app/api/studio-team/requests/route')).POST,
    post('/api/studio-team/requests'),
  ],
  [
    'trainee assignment',
    async () => (await import('../src/app/api/studio-team/trainees/route')).POST,
    post('/api/studio-team/trainees'),
  ],
  [
    'studio join requests',
    async () => (await import('../src/app/api/studio-join-requests/route')).POST,
    post('/api/studio-join-requests'),
  ],
  [
    'studio operations (memberships, terms)',
    async () => (await import('../src/app/api/studio-operations/route')).POST,
    post('/api/studio-operations'),
  ],
];

beforeEach(() => {
  vi.resetAllMocks();
  fx.getSession.mockResolvedValue(null);
});

describe('fresh session on sensitive routes', () => {
  it.each(sensitive)('%s bypasses the session cookie cache', async (_name, load, request) => {
    const handler = await load();
    const response = await handler(request);
    expect(response.status).toBe(401);
    expect(fx.getSession).toHaveBeenCalledTimes(1);
    expect(fx.getSession.mock.calls[0][0].query).toEqual({ disableCookieCache: true });
  });
  it('reads the session from the database by default', async () => {
    const { requireUser } = await import('../src/lib/security');
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    expect(fx.getSession.mock.calls[0][0].query).toEqual({ disableCookieCache: true });
  });
  it('keeps the cache on the high-frequency metrics heartbeat', async () => {
    const { POST } = await import('../src/app/api/metrics/route');
    expect((await POST(post('/api/metrics'))).status).toBe(401);
    expect(fx.getSession.mock.calls[0][0].query).toBeUndefined();
  });
});
