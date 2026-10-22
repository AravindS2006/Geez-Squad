import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, fetchJson } from '../src/lib/client';
import { logEvent } from '../src/lib/logger';
import { selectCurrentTerm } from '../src/lib/studio-operations';
import { getEmailPolicy } from '../src/lib/email-policy.mjs';
import { validateProductionConfig } from '../scripts/production-config.mjs';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('support diagnostics', () => {
  it('preserves API status and correlation without exposing HTML proxy responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>private upstream error</html>', {
          status: 502,
          headers: { 'X-Request-ID': 'support-id' },
        }),
      ),
    );
    const error = await fetchJson('/api/workspace').catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    if (!(error instanceof ApiClientError)) throw error;
    expect(error.status).toBe(502);
    expect(error.requestId).toBe('support-id');
    expect(error.message).not.toContain('private upstream');
  });
  it('preserves structured errors and successful JSON', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: 'Membership required', requestId: 'ref', code: 'MEMBERSHIP_REQUIRED' },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchJson('/api/video/token')).rejects.toMatchObject({
      status: 403,
      code: 'MEMBERSHIP_REQUIRED',
      requestId: 'ref',
    });
    expect(await fetchJson('/api/health')).toEqual({ ok: true });
  });
  it('filters log levels and excludes credentials, bodies, email and arbitrary provider messages', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {}),
      errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('LOG_LEVEL', 'warn');
    logEvent('info', 'filtered', { requestId: 'a' });
    expect(output).not.toHaveBeenCalled();
    logEvent('error', 'test_failure', {
      requestId: 'a',
      route: '/api/test',
      status: 500,
      password: 'secret',
      email: 'private@example.test',
      body: 'secret',
      message: 'token=secret',
    });
    const logged = JSON.parse(errors.mock.calls[0][0]);
    expect(logged).toMatchObject({ event: 'test_failure', requestId: 'a', status: 500 });
    expect(JSON.stringify(logged)).not.toMatch(/secret|private/);
  });
});
describe('renewal selection', () => {
  const term = (startsOn: string, endsOn: string, status = 'active') => ({
    startsOn,
    endsOn,
    status,
  });
  it('prefers active, then next upcoming, then latest expired, excluding cancelled', () => {
    const terms = [
      term('2026-09-01', '2026-09-30'),
      term('2026-12-01', '2026-12-31'),
      term('2026-11-01', '2026-11-30'),
      term('2026-10-01', '2026-10-31', 'cancelled'),
    ];
    expect(selectCurrentTerm(terms, '2026-10-22')?.startsOn).toBe('2026-11-01');
    expect(selectCurrentTerm(terms, '2026-11-22')?.startsOn).toBe('2026-11-01');
    expect(selectCurrentTerm(terms, '2027-01-01')?.startsOn).toBe('2026-12-01');
  });
});
describe('free SMTP delivery policy', () => {
  it('enables verification and recovery in SMTP mode, including local delivery testing', () => {
    expect(getEmailPolicy({ EMAIL_DELIVERY: 'smtp' })).toMatchObject({
      deliveryEnabled: true,
      requireVerification: true,
      passwordResetEnabled: true,
    });
  });
  it('requires mailbox credentials instead of a Resend key', () => {
    const errors = validateProductionConfig({ EMAIL_DELIVERY: 'smtp' }).join(' ');
    expect(errors).toContain('SMTP_PASSWORD');
    expect(errors).not.toContain('RESEND_API_KEY');
  });
});
