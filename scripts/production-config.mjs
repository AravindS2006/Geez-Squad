import { getEmailPolicy } from '../src/lib/email-policy.mjs';

export const requiredProductionKeys = [
  'DATABASE_PROVIDER',
  'DATABASE_URL',
  'DIRECT_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'CRON_SECRET',
];

const placeholder = (value) =>
  /replace-with|your-verified-domain|your-domain|<[^>@]+>|\[SENSITIVE\]|\.\.\./i.test(value);
const localHost = (host) =>
  /^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/i.test(host) || host.endsWith('.localhost');

/** Validate configuration without including secret values in diagnostics.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function validateProductionConfig(env) {
  const errors = [];
  let deliveryEnabled = true;
  try {
    const policy = getEmailPolicy({ ...env, VERCEL: '1' });
    deliveryEnabled = policy.deliveryEnabled;
    // Testing mode skips email verification and has no password reset, so anyone could
    // register another person's address and a forgotten password could not be recovered.
    if (policy.testingMode)
      errors.push(
        'EMAIL_DELIVERY=test is for local and isolated testing only; use smtp or resend in production.',
      );
  } catch {
    errors.push('EMAIL_DELIVERY must be resend, smtp, disabled, or test.');
  }
  const keys = deliveryEnabled
    ? [
        ...requiredProductionKeys,
        ...(env.EMAIL_DELIVERY === 'smtp'
          ? ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']
          : ['RESEND_API_KEY']),
        'EMAIL_FROM',
      ]
    : requiredProductionKeys;
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length) errors.push(`Missing required keys: ${missing.join(', ')}.`);
  for (const key of keys) {
    if (env[key] && placeholder(env[key])) errors.push(`${key} contains a template placeholder.`);
  }
  if (env.DATABASE_PROVIDER !== 'postgresql') errors.push('DATABASE_PROVIDER must be postgresql.');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !url.username ||
        !url.password ||
        !url.hostname ||
        url.pathname.length < 2 ||
        localHost(url.hostname) ||
        url.searchParams.get('sslmode') === 'disable'
      )
        errors.push(
          `${key} must be a remote PostgreSQL connection URL with credentials and a database; do not disable TLS.`,
        );
    } catch {
      errors.push(`${key} must be a valid PostgreSQL connection URL.`);
    }
  }
  for (const [key, protocol] of [
    ['BETTER_AUTH_URL', 'https:'],
    ['LIVEKIT_URL', 'wss:'],
  ]) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (
        url.protocol !== protocol ||
        !url.hostname ||
        localHost(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        errors.push(
          `${key} must be a secure, public origin without a path, credentials, query, or fragment.`,
        );
    } catch {
      errors.push(`${key} must be a valid secure origin.`);
    }
  }
  for (const key of ['BETTER_AUTH_SECRET', 'CRON_SECRET']) {
    if (env[key] && env[key].length < 32) errors.push(`${key} must be at least 32 characters.`);
  }
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET === env.CRON_SECRET)
    errors.push('Use independent auth and cleanup secrets.');
  if (deliveryEnabled && env.EMAIL_FROM) {
    const sender = env.EMAIL_FROM.match(/^(?:[^<>]+<)?([^<>\s]+@[^<>\s]+\.[^<>\s]+)>?$/)?.[1];
    if (!sender || /@(resend\.dev|example\.(com|test|org))$/i.test(sender))
      errors.push('EMAIL_FROM must use an actual address on your verified sending domain.');
    if (
      env.EMAIL_DELIVERY === 'smtp' &&
      sender?.toLowerCase() !== env.SMTP_USER?.trim().toLowerCase()
    )
      errors.push('SMTP EMAIL_FROM must match the authorized mailbox in SMTP_USER.');
  }
  if (env.EMAIL_DELIVERY === 'smtp' && !['465', '587'].includes(env.SMTP_PORT || '465'))
    errors.push('SMTP_PORT must be 465 or 587 with TLS.');
  if (env.LOG_LEVEL && !['debug', 'info', 'warn', 'error'].includes(env.LOG_LEVEL))
    errors.push('LOG_LEVEL must be debug, info, warn, or error.');
  // Optional alert sink (src/lib/logger.ts). Its path usually holds the webhook secret,
  // so diagnostics name the key only.
  if (env.ALERT_WEBHOOK_URL?.trim()) {
    let valid = false;
    try {
      const url = new URL(env.ALERT_WEBHOOK_URL.trim());
      valid =
        url.protocol === 'https:' && !!url.hostname && !localHost(url.hostname) && !url.username;
    } catch {
      valid = false;
    }
    if (!valid || placeholder(env.ALERT_WEBHOOK_URL))
      errors.push('ALERT_WEBHOOK_URL must be a public https webhook URL, or leave it unset.');
  }
  // Optional bearer token that unlocks per-dependency detail on /api/health.
  if (env.HEALTH_CHECK_TOKEN?.trim()) {
    if (env.HEALTH_CHECK_TOKEN.trim().length < 32)
      errors.push('HEALTH_CHECK_TOKEN must be at least 32 characters, or leave it unset.');
    if ([env.BETTER_AUTH_SECRET, env.CRON_SECRET].includes(env.HEALTH_CHECK_TOKEN))
      errors.push('Use an independent HEALTH_CHECK_TOKEN, not the auth or cleanup secret.');
  }
  const billingKeys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID'];
  const billingConfigured = billingKeys.filter((key) => !!env[key]?.trim());
  if (billingConfigured.length && billingConfigured.length !== billingKeys.length)
    errors.push('Billing requires all three Stripe keys, or leave all three unset.');
  // Optional: who may approve studio requests. Unset means no one can (requests wait).
  if (env.PLATFORM_OPERATOR_EMAILS?.trim()) {
    const entries = env.PLATFORM_OPERATOR_EMAILS.split(/[\s,]+/).filter(Boolean);
    if (
      placeholder(env.PLATFORM_OPERATOR_EMAILS) ||
      entries.some((entry) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry))
    )
      errors.push('PLATFORM_OPERATOR_EMAILS must be a comma-separated list of email addresses.');
  }
  return errors;
}
