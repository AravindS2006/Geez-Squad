import { after } from 'next/server';
import { redactPath, redactText, stackFrames } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ranks: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
// Allow fields, rather than trying to redact arbitrary request/provider payloads.
const fields = new Set([
  'requestId',
  'route',
  'method',
  'action',
  'status',
  'durationMs',
  'code',
  'type',
  'digest',
  'actorId',
  'studioId',
  'targetId',
  'provider',
  'attempt',
  'frames',
  // Free text and URLs are redacted below before they are written.
  'detail',
  'path',
  'source',
]);
// Configured secrets are masked verbatim too: provider errors can echo a credential
// that no pattern recognises.
const secretKey = /SECRET|PASSWORD|_KEY|TOKEN|DATABASE_URL|DIRECT_URL|WEBHOOK/;
function scrubSecrets(value: string) {
  let text = value;
  for (const [key, secret] of Object.entries(process.env))
    if (secretKey.test(key) && secret && secret.length >= 8)
      text = text.split(secret).join('[secret]');
  return text;
}
const redacted: Record<string, (value: string) => string | undefined> = {
  detail: (value) => redactText(scrubSecrets(value)),
  path: (value) => redactPath(value),
};
export function logEvent(level: Level, event: string, context: Record<string, unknown> = {}) {
  const safe = Object.fromEntries(
    Object.entries(context)
      .filter(
        ([key, value]) =>
          fields.has(key) &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
      )
      .map(([key, value]) => [
        key,
        typeof value === 'string'
          ? (redacted[key]?.(value) ?? value).replace(/[\r\n]/g, '').slice(0, 180)
          : value,
      ])
      .filter(([, value]) => value !== ''),
  );
  // Alerting is independent of LOG_LEVEL, so a quiet log level never hides an outage.
  queueAlert(level, event, safe);
  const configured = process.env.LOG_LEVEL as Level;
  if (ranks[level] < (ranks[configured] ?? ranks.info)) return;
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}
/**
 * Error type, code and file:line frames. The message is opt-in (withDetail), because
 * provider errors (mail, payment) can echo message contents or credentials: pass it only
 * where the text comes from our code or a library, and it is still redacted.
 */
export function errorContext(error: unknown, { withDetail = false } = {}) {
  return {
    frames:
      error instanceof Error
        ? stackFrames(error.stack?.split('\n').slice(1).join('\n'))
        : undefined,
    type: error instanceof Error ? error.name : 'unknown',
    // First line of the message only, with emails, tokens and URL queries removed.
    detail:
      withDetail && error instanceof Error ? redactText(error.message) || undefined : undefined,
    code:
      error &&
      typeof error === 'object' &&
      'code' in error &&
      /^[A-Z][A-Z0-9_]{1,60}$/.test(String(error.code))
        ? String(error.code)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Optional alert sink. When ALERT_WEBHOOK_URL is set, error-level events and the
// named critical events below are POSTed as a short Slack-compatible message.
// Only allow-listed, already-redacted fields are sent: never actor, studio or
// target ids, free text, paths or secrets.

/** Critical events that alert even below error level, with a human label. */
export const criticalEvents: Record<string, string> = {
  schema_readiness_failed: 'Database unavailable or schema behind the deployed code',
  health_dependency_down: 'A required dependency failed the health check',
  billing_webhook_failed: 'Billing webhook processing failed',
  orphaned_room_cleanup_failed: 'Class room cleanup failed after a start or cancel',
};
/** Routes whose failures name a known operation in the alert text. */
const criticalRoutes: Record<string, string> = {
  '/api/retention': 'Retention cron failed',
  '/api/health': 'Health check failed',
  '/api/command': 'Workspace command failed (class start, cancel or other control)',
};
const alertFields = [
  'route',
  'method',
  'status',
  'code',
  'type',
  'digest',
  'requestId',
  'provider',
  'action',
] as const;
export const ALERT_THROTTLE_MS = 5 * 60_000;
const ALERT_TIMEOUT_MS = 3_000;
const alertSentAt = new Map<string, number>();
const alertedRequests: string[] = [];

export function alertWebhookUrl(env: Record<string, string | undefined> = process.env) {
  const raw = env.ALERT_WEBHOOK_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Decide whether an event alerts, and build the message. Pure apart from the throttle state. */
export function alertMessage(
  level: Level,
  event: string,
  safe: Record<string, unknown>,
  now = Date.now(),
) {
  const critical = criticalEvents[event];
  if (level !== 'error' && !critical) return undefined;
  const requestId = typeof safe.requestId === 'string' ? safe.requestId : undefined;
  // The request summary repeats an error already alerted for the same request.
  if (event === 'request_complete' && requestId && alertedRequests.includes(requestId))
    return undefined;
  const route = typeof safe.route === 'string' ? safe.route : '';
  const key = `${event}:${route}`;
  const last = alertSentAt.get(key);
  if (last !== undefined && now - last < ALERT_THROTTLE_MS) return undefined;
  alertSentAt.set(key, now);
  if (requestId) {
    alertedRequests.push(requestId);
    if (alertedRequests.length > 50) alertedRequests.shift();
  }
  const label = critical ?? criticalRoutes[route] ?? 'Server error';
  const details = Object.fromEntries(
    alertFields.filter((field) => safe[field] !== undefined).map((field) => [field, safe[field]]),
  );
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';
  const summary = [
    event,
    route && `on ${route}`,
    details.status !== undefined && `status ${details.status}`,
    details.type && `type ${details.type}`,
    details.code && `code ${details.code}`,
    requestId && `request ${requestId}`,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    text: `[Geez Squad ${environment}] ${label}: ${summary}. Repeats of this event are muted for 5 minutes.`,
    event,
    level,
    environment,
    timestamp: new Date(now).toISOString(),
    ...details,
  };
}

function queueAlert(level: Level, event: string, safe: Record<string, unknown>) {
  if (event === 'alert_delivery_failed') return;
  const url = alertWebhookUrl();
  if (!url) return;
  const message = alertMessage(level, event, safe);
  if (!message) return;
  const deliver = async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!response.ok)
        logEvent('warn', 'alert_delivery_failed', { status: response.status, action: event });
    } catch (error) {
      logEvent('warn', 'alert_delivery_failed', {
        action: event,
        type: error instanceof Error ? error.name : 'unknown',
      });
    }
  };
  // Inside a request, run after the response is sent. Outside one (instrumentation,
  // scripts, tests) `after` throws, so send without awaiting.
  try {
    after(deliver);
  } catch {
    void deliver();
  }
}

/** Test hook: forget throttle state. */
export function resetAlertState() {
  alertSentAt.clear();
  alertedRequests.length = 0;
}
