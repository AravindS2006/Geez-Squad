import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RoomServiceClient } from 'livekit-server-sdk';
import { getEmailPolicy } from './email-policy.mjs';

type Env = Record<string, string | undefined>;
type Model = {
  name: string;
  dbName?: string | null;
  fields: readonly { name: string; dbName?: string | null; kind: string }[];
};

/**
 * Every table and column the generated client expects, from the Prisma data model.
 * The schema and the paired migrations must agree (tests/health-schema.test.ts proves
 * it against prisma/postgres/migrations), so this never needs a hand-kept list.
 */
export function expectedSchema(models: readonly Model[] = Prisma.dmmf.datamodel.models) {
  return models.map((model) => ({
    table: model.dbName || model.name,
    columns: model.fields
      .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
      .map((field) => field.dbName || field.name),
  }));
}

const quote = (identifier: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier))
    throw new Error('Unexpected identifier in the data model.');
  return `"${identifier}"`;
};

/**
 * One statement that names every expected column and reads no rows. It fails on a
 * missing table or column in both SQLite and PostgreSQL, without touching personal data.
 */
export function schemaProbeSql(schema = expectedSchema()) {
  return schema
    .map(
      ({ table, columns }) =>
        `SELECT 1 FROM ${quote(table)} WHERE 1 = 0 AND (${columns
          .map((column) => `${quote(column)} IS NULL`)
          .join(' OR ')})`,
    )
    .join(' UNION ALL ');
}

export type MailStatus = 'ok' | 'disabled' | 'misconfigured';
/** Configuration only: a live SMTP or Resend call would be slow and could send mail. */
export function mailStatus(env: Env = process.env): MailStatus {
  let policy: ReturnType<typeof getEmailPolicy>;
  try {
    policy = getEmailPolicy(env);
  } catch {
    return 'misconfigured';
  }
  if (!policy.deliveryEnabled) return 'disabled';
  const keys =
    policy.mode === 'smtp'
      ? ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM']
      : ['RESEND_API_KEY', 'EMAIL_FROM'];
  return keys.every((key) => env[key]?.trim()) ? 'ok' : 'misconfigured';
}

export type LiveKitStatus = 'ok' | 'disabled' | 'down';
export const LIVEKIT_TIMEOUT_MS = 2_000;
const LIVEKIT_CACHE_MS = 30_000;
let livekitCache: { at: number; status: LiveKitStatus } | undefined;

/**
 * Authenticated, read-only LiveKit call (list one room by a name that never exists)
 * with a short timeout. Cached briefly so a burst of health checks cannot fan out.
 */
export async function livekitStatus(
  env: Env = process.env,
  listRooms: (host: string, key: string, secret: string) => Promise<unknown> = (
    host,
    key,
    secret,
  ) => new RoomServiceClient(host, key, secret).listRooms(['geez-health-probe']),
  now = Date.now(),
): Promise<LiveKitStatus> {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = env;
  if (!url?.trim() || !key?.trim() || !secret?.trim()) return 'disabled';
  if (livekitCache && now - livekitCache.at < LIVEKIT_CACHE_MS) return livekitCache.status;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'down'>((resolve) => {
    timer = setTimeout(() => resolve('down'), LIVEKIT_TIMEOUT_MS);
  });
  const call = listRooms(url.trim().replace(/^ws/, 'http'), key, secret).then(
    () => 'ok' as const,
    () => 'down' as const,
  );
  const status = await Promise.race([call, timeout]);
  clearTimeout(timer);
  livekitCache = { at: now, status };
  return status;
}

/** Test hook. */
export function resetHealthCache() {
  livekitCache = undefined;
}

/**
 * True when the caller presents `Authorization: Bearer <HEALTH_CHECK_TOKEN>`. Only then
 * does /api/health name each dependency; anonymous callers learn the overall status only.
 * Both sides are hashed first, so the comparison is constant-time for any length.
 */
export function hasHealthToken(authorization: string | null, env: Env = process.env) {
  const token = env.HEALTH_CHECK_TOKEN?.trim();
  if (!token || !authorization) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${token}`));
}

export type HealthChecks = {
  database: 'ok' | 'down';
  livekit: LiveKitStatus;
  mail: MailStatus;
};
/** A configured dependency that is down, or mail delivery switched on without credentials. */
export function failingChecks(checks: HealthChecks) {
  return (Object.keys(checks) as (keyof HealthChecks)[]).filter(
    (name) => checks[name] === 'down' || checks[name] === 'misconfigured',
  );
}
