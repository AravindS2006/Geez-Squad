import { describe, expect, it } from 'vitest';
import { getEmailPolicy } from '../src/lib/email-policy.mjs';

describe('deferred email authentication', () => {
  it('allows production testing signup without claiming email ownership or enabling mail', () => {
    const policy = getEmailPolicy({ VERCEL: '1', EMAIL_DELIVERY: 'test' });
    expect(policy.testingMode).toBe(true);
    expect(policy.requireVerification).toBe(false);
    expect(policy.signupEnabled).toBe(true);
    expect(policy.deliveryEnabled).toBe(false);
    expect(policy.passwordResetEnabled).toBe(false);
  });
  it('requires verification again when moving from testing to email delivery', () => {
    const policy = getEmailPolicy({ VERCEL: '1', EMAIL_DELIVERY: 'resend' });
    expect(policy.testingMode).toBe(false);
    expect(policy.requireVerification).toBe(true);
  });
  it('keeps production verification mandatory while closing signup and reset', () => {
    const policy = getEmailPolicy({ VERCEL: '1', EMAIL_DELIVERY: 'disabled' });
    expect(policy.requireVerification).toBe(true);
    expect(policy.signupEnabled).toBe(false);
    expect(policy.passwordResetEnabled).toBe(false);
    expect(policy.deliveryEnabled).toBe(false);
  });
  it('does not turn on delivery just because an API key is present', () => {
    expect(
      getEmailPolicy({ VERCEL: '1', EMAIL_DELIVERY: 'disabled', RESEND_API_KEY: 'key' })
        .deliveryEnabled,
    ).toBe(false);
  });
  it('defaults production to verified signup with email delivery', () => {
    const policy = getEmailPolicy({ VERCEL: '1' });
    expect(policy.requireVerification).toBe(true);
    expect(policy.deliveryEnabled).toBe(true);
    expect(policy.signupEnabled).toBe(true);
  });
  it('allows explicit email delivery to restore signup and reset', () => {
    const policy = getEmailPolicy({ VERCEL: '1', EMAIL_DELIVERY: 'resend' });
    expect(policy.signupEnabled).toBe(true);
    expect(policy.passwordResetEnabled).toBe(true);
    expect(policy.requireVerification).toBe(true);
  });
  it('keeps disposable local signup available without email', () => {
    const policy = getEmailPolicy({});
    expect(policy.signupEnabled).toBe(true);
    expect(policy.requireVerification).toBe(false);
    expect(policy.passwordResetEnabled).toBe(false);
  });
  it('rejects invalid configuration rather than changing authentication behavior', () => {
    expect(() => getEmailPolicy({ VERCEL: '1', EMAIL_DELIVERY: 'false' })).toThrow(
      'EMAIL_DELIVERY must be resend, smtp, disabled, or test.',
    );
  });
});
