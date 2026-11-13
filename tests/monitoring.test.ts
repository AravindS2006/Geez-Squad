import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_THROTTLE_MS,
  alertMessage,
  alertWebhookUrl,
  errorContext,
  logEvent,
  resetAlertState,
} from '../src/lib/logger';
import { redactPath, redactText, stackFrames } from '../src/lib/redact';
import { loggedRoute } from '../src/lib/request-log';

// Load the real auth configuration with the library and its dependencies stubbed, so
// the logger callback it passes to Better Auth can be exercised directly.
vi.mock('server-only', () => ({}));
vi.mock('better-auth', () => ({ betterAuth: (options: unknown) => options }));
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: () => ({}) }));
vi.mock('../src/lib/db', () => ({ db: {}, databaseProvider: () => 'sqlite' }));
vi.mock('../src/lib/mail', () => ({ sendMail: vi.fn() }));
import { auth } from '../src/lib/auth';
type AuthLogger = { log: (level: 'error', message: string, ...args: unknown[]) => void };

beforeEach(() => {
  resetAlertState();
  vi.stubEnv('LOG_LEVEL', 'info');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('redaction', () => {
  it('removes emails, tokens, credentials and URL queries from error text', () => {
    const text = redactText(
      'Failed for jane@example.test at https://app.test/reset?token=abc123 Bearer eyJhbGciOi.eyJzdWIi.sig password=hunter2 key 9f8e7d6c5b4a39281706f5e4d3c2b1a0 call +91 98765 43210\nsecond line',
    );
    expect(text).not.toMatch(/jane|abc123|hunter2|eyJ|9f8e7d6c|98765|second line/);
    expect(text).toContain('[email]');
    expect(text).toContain('https://app.test/reset');
    expect(text).toContain('password=[redacted]');
  });
  it('keeps a path without origin, query or id-like segments', () => {
    expect(redactPath('https://app.test/reset-password/AbC123dEf456GhI789jK?x=1#y')).toBe(
      '/reset-password/:id',
    );
    expect(redactPath('/studio/jane%40example.test/classes/12345')).toBe(
      '/studio/:email/classes/:id',
    );
    expect(redactPath(42)).toBeUndefined();
  });
  it('reduces stacks to file:line:column frames without hosts', () => {
    expect(
      stackFrames(
        'TypeError: x\n    at go (https://app.test/_next/static/chunks/page-1a2b.js:1:2345)\n    at C:\\Users\\private\\app\\src\\lib\\db.ts:4:5',
      ),
    ).toBe('page-1a2b.js:1:2345 <- db.ts:4:5');
  });
  it('logs a redacted error message, name and frames', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new TypeError('Lookup failed for jane@example.test');
    logEvent('error', 'probe', {
      ...errorContext(error, { withDetail: true }),
      cookie: 'session=1',
      body: 'x',
    });
    const logged = JSON.parse(output.mock.calls[0][0]);
    expect(logged).toMatchObject({ type: 'TypeError', detail: 'Lookup failed for [email]' });
    expect(logged.frames).toMatch(/monitoring\.test\.ts:\d+:\d+/);
    expect(JSON.stringify(logged)).not.toMatch(/jane|session=1/);
  });
  it('omits the message by default and masks configured secrets when it is included', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('SMTP_PASSWORD', 'plain words secret');
    const error = new Error('rejected plain words secret for mailbox');
    expect(errorContext(error).detail).toBeUndefined();
    logEvent('error', 'probe', errorContext(error, { withDetail: true }));
    const logged = JSON.parse(output.mock.calls[0][0]);
    expect(logged.detail).toBe('rejected [secret] for mailbox');
  });
});

describe('silent log paths', () => {
  it('keeps the Better Auth message but never a passed error message', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mailError = Object.assign(
      new Error('550 mailbox unavailable for Recipient Person at their workplace'),
      { code: 'EENVELOPE' },
    );
    (auth as unknown as { logger: AuthLogger }).logger.log(
      'error',
      'Failed to send verification email',
      mailError,
    );
    const line = String(output.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      event: 'auth_event',
      detail: 'Failed to send verification email',
      type: 'Error',
      code: 'EENVELOPE',
    });
    expect(line).not.toMatch(/550|mailbox|Recipient Person|workplace/);
  });
  it('logs an unhandled route error with its type and message', async () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const route = loggedRoute('/api/probe', async () => {
      throw new RangeError('Bad offset');
    });
    await expect(route(new Request('http://localhost/api/probe'))).rejects.toThrow('Bad offset');
    const logged = JSON.parse(output.mock.calls[0][0]);
    expect(logged).toMatchObject({
      event: 'request_unhandled',
      route: '/api/probe',
      type: 'RangeError',
      detail: 'Bad offset',
    });
    expect(logged.requestId).toEqual(expect.any(String));
  });
});

describe('alert sink', () => {
  const send = () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  it('is off unless ALERT_WEBHOOK_URL is a usable https URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = send();
    logEvent('error', 'api_error', { route: '/api/x' });
    expect(alertWebhookUrl({ ALERT_WEBHOOK_URL: 'http://hooks.example.test/x' })).toBeUndefined();
    expect(alertWebhookUrl({ ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' })).toBeDefined();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('posts a short Slack-compatible message without personal data, with a timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example.test/services/secret-path');
    const fetchMock = send();
    logEvent('error', 'api_error', {
      requestId: 'req-1',
      route: '/api/retention',
      status: 500,
      type: 'PrismaClientKnownRequestError',
      code: 'P1001',
      actorId: 'user-private',
      studioId: 'studio-private',
      detail: 'jane@example.test',
      path: '/studio/x',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://hooks.example.test/services/secret-path');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.text).toContain('Retention cron failed');
    expect(body.text).toContain('code P1001');
    expect(body).toMatchObject({ event: 'api_error', route: '/api/retention', status: 500 });
    expect(init.body).not.toMatch(/private|jane|studio\/x|secret-path/);
  });
  it('throttles per event and route, skips repeated request summaries and lower levels', () => {
    const now = 1_000_000;
    expect(alertMessage('error', 'api_error', { route: '/a', requestId: 'r1' }, now)).toBeDefined();
    expect(alertMessage('error', 'api_error', { route: '/a' }, now + 1_000)).toBeUndefined();
    expect(alertMessage('error', 'api_error', { route: '/b' }, now + 1_000)).toBeDefined();
    expect(
      alertMessage('error', 'request_complete', { route: '/a', requestId: 'r1' }, now),
    ).toBeUndefined();
    expect(
      alertMessage('error', 'api_error', { route: '/a' }, now + ALERT_THROTTLE_MS),
    ).toBeDefined();
    expect(alertMessage('warn', 'client_error', {}, now)).toBeUndefined();
    expect(alertMessage('warn', 'orphaned_room_cleanup_failed', {}, now)?.text).toContain(
      'Class room cleanup failed',
    );
    expect(alertMessage('error', 'schema_readiness_failed', {}, now)?.text).toContain(
      'Database unavailable',
    );
  });
  it('never throws or alerts recursively when the webhook fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example.test/x');
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect(() => logEvent('error', 'api_error', { route: '/c' })).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(JSON.parse(warn.mock.calls[0][0]).event).toBe('alert_delivery_failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
