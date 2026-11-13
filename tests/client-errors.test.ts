import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestApiError, testSafeError } from './route-mocks';

const fixture = vi.hoisted(() => ({
  getSession: vi.fn(),
  rateLimit: vi.fn(),
  checkOrigin: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: fixture.getSession } } }));
vi.mock('@/lib/security', () => ({
  ApiError: TestApiError,
  safeError: testSafeError,
  rateLimit: fixture.rateLimit,
  checkOrigin: fixture.checkOrigin,
}));
import { POST } from '../src/app/api/client-errors/route';
import {
  buildClientErrorReport,
  createClientErrorReporter,
} from '../src/lib/client-error-reporter';
import { clientAddress, clientAddressKey, clientErrorSchema } from '../src/lib/client-error-report';

const report = {
  source: 'window',
  name: 'TypeError',
  message: 'x is undefined for jane@example.test',
  stack: 'TypeError: x\n    at f (https://app.test/_next/static/chunks/room-9a.js:3:44)',
  url: 'https://app.test/workspace/live?token=secret-token#frag',
};
const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/client-errors', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        cookie: 'better-auth.session_token=cookie-secret',
        ...headers,
      },
      body,
    }),
  );

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'info');
  fixture.getSession.mockResolvedValue(null);
  fixture.rateLimit.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('client error reporter', () => {
  it('dedupes the same error across sources and caps reports per page', () => {
    const sent: string[] = [];
    const reportError = createClientErrorReporter((body) => sent.push(body), 3);
    const error = new Error('boom');
    expect(reportError(buildClientErrorReport('window', error, '/a'))).toBe(true);
    expect(reportError(buildClientErrorReport('boundary', error, '/a'))).toBe(false);
    for (let i = 0; i < 5; i++) reportError(buildClientErrorReport('rejection', `fail ${i}`));
    expect(sent).toHaveLength(3);
  });
  it('pre-redacts the message and URL and ignores opaque script errors', () => {
    const built = buildClientErrorReport(
      'rejection',
      new Error('Failed for jane@example.test'),
      'https://app.test/invite/AbC123dEf456GhI789?code=1',
      'digest_1',
    )!;
    expect(built).toMatchObject({
      source: 'rejection',
      message: 'Failed for [email]',
      url: '/invite/:id',
      digest: 'digest_1',
    });
    expect(buildClientErrorReport('window', 'Script error.')).toBeUndefined();
    expect(() =>
      createClientErrorReporter(() => {
        throw new Error('offline');
      })(built),
    ).not.toThrow();
  });
  it('rejects unknown fields and oversize values', () => {
    expect(clientErrorSchema.safeParse({ ...report, cookie: 'x' }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ ...report, message: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
  it('hashes the caller address for the rate-limit key', () => {
    const key = clientAddressKey(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    expect(key).toMatch(/^ip-[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.9');
  });
  it('prefers platform-set address headers and ignores a client-chosen forwarded entry', () => {
    expect(
      clientAddress(
        new Headers({
          'x-vercel-forwarded-for': '198.51.100.7',
          'x-real-ip': '198.51.100.8',
          'x-forwarded-for': '203.0.113.9',
        }),
      ),
    ).toBe('198.51.100.7');
    expect(
      clientAddress(new Headers({ 'x-real-ip': '198.51.100.8', 'x-forwarded-for': '1.2.3.4' })),
    ).toBe('198.51.100.8');
    // Without platform headers, the first (client-supplied) entry never decides the bucket.
    const rotated = ['1.1.1.1', '2.2.2.2'].map((spoofed) =>
      clientAddressKey(new Headers({ 'x-forwarded-for': `${spoofed}, 10.0.0.1` })),
    );
    expect(rotated[0]).toBe(rotated[1]);
  });
});

describe('client error route', () => {
  it('logs a redacted report from a beacon without cookies, queries or the raw body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await post(JSON.stringify(report));
    expect(response.status).toBe(204);
    expect(fixture.checkOrigin).toHaveBeenCalled();
    expect(fixture.rateLimit.mock.calls).toEqual([
      ['anonymous-all', 'client-error', 300],
      [expect.stringMatching(/^ip-/), 'client-error', 20],
    ]);
    const line = warn.mock.calls
      .map((call) => String(call[0]))
      .find((l) => l.includes('client_error'))!;
    const logged = JSON.parse(line);
    expect(logged).toMatchObject({
      event: 'client_error',
      source: 'window',
      type: 'TypeError',
      path: '/workspace/live',
      frames: 'room-9a.js:3:44',
    });
    expect(logged.actorId).toBeUndefined();
    expect(line).not.toMatch(/jane|secret-token|cookie-secret|frag|203\.0\.113/);
  });
  it('attaches the session user id and rate limits that user too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fixture.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    const response = await post(JSON.stringify(report), { 'content-type': 'application/json' });
    expect(response.status).toBe(204);
    expect(fixture.rateLimit).toHaveBeenCalledWith('user-1', 'client-error', 20);
    expect(fixture.rateLimit).not.toHaveBeenCalledWith('anonymous-all', 'client-error', 300);
    const line = warn.mock.calls
      .map((call) => String(call[0]))
      .find((l) => l.includes('client_error'))!;
    expect(JSON.parse(line).actorId).toBe('user-1');
  });
  it('caps anonymous reports globally, so rotating the forwarded address cannot exceed it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let anonymous = 0;
    fixture.rateLimit.mockImplementation(async (id: string, _action: string, max: number) => {
      if (id === 'anonymous-all' && ++anonymous > max) throw new TestApiError(429, 'Wait.');
    });
    const statuses = [];
    for (let i = 0; i < 305; i++)
      statuses.push(
        (await post(JSON.stringify(report), { 'x-forwarded-for': `10.0.${i}.1` })).status,
      );
    expect(statuses.filter((status) => status === 204)).toHaveLength(300);
    expect(statuses.slice(300)).toEqual([429, 429, 429, 429, 429]);
    // A spent shared bucket stops before a per-address row is created or anything is logged.
    const addressCalls = fixture.rateLimit.mock.calls.filter(([id]) =>
      String(id).startsWith('ip-'),
    );
    expect(addressCalls).toHaveLength(300);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('client_error'))).toHaveLength(
      300,
    );
  });
  it('refuses oversize, malformed, wrongly typed and rate-limited reports', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await post('x'.repeat(9_000))).status).toBe(413);
    expect((await post('{not json')).status).toBe(400);
    expect((await post(JSON.stringify({ ...report, source: 'other' }))).status).toBe(500);
    expect((await post(JSON.stringify(report), { 'content-type': 'text/html' })).status).toBe(415);
    fixture.rateLimit.mockRejectedValueOnce(new TestApiError(429, 'Wait.'));
    expect((await post(JSON.stringify(report))).status).toBe(429);
  });
});
