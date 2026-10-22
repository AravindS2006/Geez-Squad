import { describe, expect, it } from 'vitest';
import { validateProductionConfig } from '../scripts/production-config.mjs';

const valid = {
  DATABASE_PROVIDER: 'postgresql',
  DATABASE_URL: 'postgresql://user:password@db.neon.tech/geez-squad?sslmode=require',
  DIRECT_URL: 'postgresql://user:password@direct.neon.tech/geez-squad?sslmode=require',
  BETTER_AUTH_SECRET: 'a'.repeat(43),
  BETTER_AUTH_URL: 'https://geez-squad.vercel.app',
  LIVEKIT_URL: 'wss://geez-squad.livekit.cloud',
  LIVEKIT_API_KEY: 'key-for-test-only',
  LIVEKIT_API_SECRET: 'secret-for-test-only',
  RESEND_API_KEY: 're_test-only',
  EMAIL_FROM: 'Geez Squad <hello@geez-squad.in>',
  CRON_SECRET: 'b'.repeat(43),
};
describe('production deployment guard', () => {
  it('accepts a free Gmail sender with SMTP instead of requiring a sending domain', () => {
    expect(
      validateProductionConfig({
        ...valid,
        EMAIL_DELIVERY: 'smtp',
        RESEND_API_KEY: undefined,
        EMAIL_FROM: 'Geez Squad <studio@gmail.com>',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'studio@gmail.com',
        SMTP_PASSWORD: 'test-app-password',
        SMTP_PORT: '465',
      }),
    ).toEqual([]);
  });
  it('rejects insecure SMTP ports and a sender different from the authorized mailbox', () => {
    const result = validateProductionConfig({
      ...valid,
      EMAIL_DELIVERY: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'studio@gmail.com',
      SMTP_PASSWORD: 'test-app-password',
      SMTP_PORT: '25',
    }).join(' ');
    expect(result).toContain('SMTP_PORT');
    expect(result).toContain('SMTP_USER');
  });
  it('accepts complete configuration with billing disabled', () => {
    expect(validateProductionConfig(valid)).toEqual([]);
  });
  it('allows explicitly deferred email with no sender or API key', () => {
    expect(
      validateProductionConfig({
        ...valid,
        EMAIL_DELIVERY: 'disabled',
        EMAIL_FROM: undefined,
        RESEND_API_KEY: undefined,
      }),
    ).toEqual([]);
  });
  it('allows explicitly selected testing signup without mail credentials', () => {
    expect(
      validateProductionConfig({
        ...valid,
        EMAIL_DELIVERY: 'test',
        EMAIL_FROM: undefined,
        RESEND_API_KEY: undefined,
      }),
    ).toEqual([]);
  });
  it('ignores dormant mail credentials when delivery is explicitly disabled', () => {
    expect(
      validateProductionConfig({
        ...valid,
        EMAIL_DELIVERY: 'disabled',
        EMAIL_FROM: 'onboarding@resend.dev',
        RESEND_API_KEY: '[SENSITIVE]',
      }),
    ).toEqual([]);
  });
  it('still requires a real sender when delivery is enabled or unspecified', () => {
    for (const mode of ['resend', undefined])
      expect(
        validateProductionConfig({ ...valid, EMAIL_DELIVERY: mode, EMAIL_FROM: undefined }),
      ).toContainEqual(expect.stringContaining('EMAIL_FROM'));
  });
  it('rejects unknown delivery modes rather than silently disabling email', () => {
    expect(validateProductionConfig({ ...valid, EMAIL_DELIVERY: 'disable' })).toContain(
      'EMAIL_DELIVERY must be resend, smtp, disabled, or test.',
    );
  });
  it('reports missing services using key names only', () => {
    expect(validateProductionConfig({})).toContainEqual(
      expect.stringContaining('LIVEKIT_API_SECRET'),
    );
  });
  it.each([
    'file:./dev.db',
    'postgresql-not-a-url',
    'postgresql://user:password@localhost/geez-squad',
    'postgresql://user:password@db.neon.tech/geez-squad?sslmode=disable',
  ])('rejects unsafe database configuration: %s', (url) => {
    expect(validateProductionConfig({ ...valid, DATABASE_URL: url }).join(' ')).toContain(
      'DATABASE_URL',
    );
  });
  it.each([
    'http://geez-squad.vercel.app',
    'https://localhost:3000',
    'https://geez-squad.vercel.app/login',
    'https://geez-squad.vercel.app?redirect=elsewhere',
    'https://user:password@geez-squad.vercel.app',
  ])('rejects an invalid auth origin: %s', (url) => {
    expect(validateProductionConfig({ ...valid, BETTER_AUTH_URL: url }).join(' ')).toContain(
      'BETTER_AUTH_URL',
    );
  });
  it('rejects weak or reused cleanup secrets', () => {
    expect(validateProductionConfig({ ...valid, CRON_SECRET: 'short' }).join(' ')).toContain(
      'CRON_SECRET',
    );
    expect(
      validateProductionConfig({ ...valid, CRON_SECRET: valid.BETTER_AUTH_SECRET }).join(' '),
    ).toContain('independent');
  });
  it('rejects template configuration and the restricted email test domain', () => {
    expect(
      validateProductionConfig({
        ...valid,
        EMAIL_FROM: 'Geez Squad <hello@your-verified-domain.com>',
      }).join(' '),
    ).toContain('placeholder');
    expect(
      validateProductionConfig({ ...valid, EMAIL_FROM: 'onboarding@resend.dev' }).join(' '),
    ).toContain('EMAIL_FROM');
  });
  it('rejects partially enabled billing', () => {
    expect(
      validateProductionConfig({ ...valid, STRIPE_SECRET_KEY: 'sk_test_sample' }).join(' '),
    ).toContain('all three');
  });
  it('rejects write-only secret placeholders returned by Vercel env pull', () => {
    expect(
      validateProductionConfig({ ...valid, LIVEKIT_API_SECRET: '[SENSITIVE]' }).join(' '),
    ).toContain('LIVEKIT_API_SECRET');
  });
  it('never includes secret values in configuration errors', () => {
    const database = 'postgresql://someone:private-password@localhost/geez-squad';
    const errors = validateProductionConfig({
      ...valid,
      DATABASE_URL: database,
      BETTER_AUTH_SECRET: 'private-secret',
    }).join(' ');
    expect(errors).not.toContain(database);
    expect(errors).not.toContain('private-password');
    expect(errors).not.toContain('private-secret');
  });
});
