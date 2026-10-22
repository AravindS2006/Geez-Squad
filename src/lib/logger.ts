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
]);
export function logEvent(level: Level, event: string, context: Record<string, unknown> = {}) {
  const configured = process.env.LOG_LEVEL as Level;
  if (ranks[level] < (ranks[configured] ?? ranks.info)) return;
  const safe = Object.fromEntries(
    Object.entries(context)
      .filter(
        ([key, value]) =>
          fields.has(key) &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
      )
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.replace(/[\r\n]/g, '').slice(0, 180) : value,
      ]),
  );
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safe });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}
export function errorContext(error: unknown) {
  return {
    frames:
      error instanceof Error
        ? error.stack
            ?.split('\n')
            .slice(1)
            .map((line) => line.match(/([A-Za-z0-9_.\[\]-]+\.(?:tsx?|m?js):\d+:\d+)/)?.[1])
            .filter(Boolean)
            .slice(0, 4)
            .join(' <- ')
        : undefined,
    type: error instanceof Error ? error.name : 'unknown',
    code:
      error &&
      typeof error === 'object' &&
      'code' in error &&
      /^[A-Z][A-Z0-9_]{1,60}$/.test(String(error.code))
        ? String(error.code)
        : undefined,
  };
}
