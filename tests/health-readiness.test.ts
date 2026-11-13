import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: vi.fn(), listRooms: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRawUnsafe: fixture.query } }));
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    listRooms = fixture.listRooms;
  },
}));
import { GET } from '../src/app/api/health/route';
import {
  expectedSchema,
  failingChecks,
  hasHealthToken,
  livekitStatus,
  mailStatus,
  resetHealthCache,
  schemaProbeSql,
} from '../src/lib/health';

const migrationsDir = join(process.cwd(), 'prisma', 'postgres', 'migrations');
/** Tables and columns the committed PostgreSQL migrations create (they are additive only). */
function migratedSchema() {
  const tables = new Map<string, Set<string>>();
  for (const dir of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const sql = readFileSync(join(migrationsDir, dir.name, 'migration.sql'), 'utf8');
    for (const statement of sql.split(';')) {
      const create = statement.match(/CREATE TABLE "(\w+)" \(([\s\S]*)\)/);
      if (create) {
        const columns = [...create[2].matchAll(/^\s*"(\w+)"\s/gm)].map((m) => m[1]);
        tables.set(create[1], new Set(columns));
        continue;
      }
      const alter = statement.match(/ALTER TABLE "(\w+)"/);
      if (alter)
        for (const m of statement.matchAll(/ADD COLUMN\s+"(\w+)"/g))
          tables.get(alter[1])!.add(m[1]);
    }
  }
  return tables;
}

beforeEach(() => {
  resetHealthCache();
  vi.stubEnv('LIVEKIT_URL', '');
  vi.stubEnv('LIVEKIT_API_KEY', '');
  vi.stubEnv('LIVEKIT_API_SECRET', '');
  vi.stubEnv('EMAIL_DELIVERY', 'disabled');
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('health schema coverage', () => {
  it('checks every table and column the PostgreSQL migrations create', () => {
    const migrated = migratedSchema();
    const expected = new Map(expectedSchema().map((t) => [t.table, new Set(t.columns)]));
    // Coverage, not equality: the generated client may already expect a table or column
    // whose migration ships with it, and then the probe rightly fails until it is applied.
    expect([...expected.keys()]).toEqual(expect.arrayContaining([...migrated.keys()]));
    for (const [table, columns] of migrated)
      expect([...expected.get(table)!], table).toEqual(expect.arrayContaining([...columns]));
    // Tables added by the latest migrations are covered without a hand-kept list.
    for (const table of ['NutritionEntry', 'CustomExercise', 'WorkoutCorrection'])
      expect(expected.has(table)).toBe(true);
  });
  it('builds one row-free probe that names every expected column', () => {
    const sql = schemaProbeSql();
    expect(sql).toContain('FROM "WorkoutCorrection" WHERE 1 = 0');
    expect(sql).not.toMatch(/SELECT \*/);
    for (const { table, columns } of expectedSchema()) {
      expect(sql).toContain(`FROM "${table}"`);
      for (const column of columns) expect(sql).toContain(`"${column}" IS NULL`);
    }
    expect(() => schemaProbeSql([{ table: 'Bad"; --', columns: ['id'] }])).toThrow();
  });
});

describe('health dependencies', () => {
  it('reports mail configuration without contacting a provider', () => {
    expect(mailStatus({ EMAIL_DELIVERY: 'disabled' })).toBe('disabled');
    expect(mailStatus({ EMAIL_DELIVERY: 'test' })).toBe('disabled');
    expect(mailStatus({ EMAIL_DELIVERY: 'resend', EMAIL_FROM: 'a@b.test' })).toBe('misconfigured');
    expect(
      mailStatus({ EMAIL_DELIVERY: 'resend', EMAIL_FROM: 'a@b.test', RESEND_API_KEY: 'k' }),
    ).toBe('ok');
    expect(mailStatus({ EMAIL_DELIVERY: 'carrier-pigeon' })).toBe('misconfigured');
  });
  it('treats LiveKit as down on error or timeout and caches the result briefly', async () => {
    const env = { LIVEKIT_URL: 'wss://lk.test', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' };
    expect(await livekitStatus({})).toBe('disabled');
    const list = vi.fn().mockRejectedValue(new Error('401'));
    expect(await livekitStatus(env, list, 0)).toBe('down');
    expect(list).toHaveBeenCalledWith('https://lk.test', 'k', 's');
    expect(await livekitStatus(env, list, 1_000)).toBe('down');
    expect(list).toHaveBeenCalledTimes(1);
    resetHealthCache();
    vi.useFakeTimers();
    const pending = livekitStatus(env, () => new Promise(() => undefined), 0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBe('down');
    resetHealthCache();
    vi.useRealTimers();
    expect(await livekitStatus(env, async () => [], 0)).toBe('ok');
  });
  it('fails only on a down or misconfigured dependency', () => {
    expect(failingChecks({ database: 'ok', livekit: 'disabled', mail: 'disabled' })).toEqual([]);
    expect(failingChecks({ database: 'down', livekit: 'down', mail: 'misconfigured' })).toEqual([
      'database',
      'livekit',
      'mail',
    ]);
  });
});

const TOKEN = 'h'.repeat(40);
const anonymous = () => GET(new Request('http://localhost/api/health'));
const operator = (token = TOKEN) =>
  GET(
    new Request('http://localhost/api/health', { headers: { authorization: `Bearer ${token}` } }),
  );

describe('health readiness route', () => {
  beforeEach(() => vi.stubEnv('HEALTH_CHECK_TOKEN', TOKEN));
  it('gives anonymous callers the overall status only', async () => {
    fixture.query.mockResolvedValue([{ secret: 'row' }]);
    const response = await anonymous();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fixture.query).toHaveBeenCalledWith(schemaProbeSql());
    expect(await (await operator('wrong-token')).json()).toEqual({ status: 'ok' });
  });
  it('names each dependency for a caller with the health token, never query results', async () => {
    fixture.query.mockResolvedValue([{ secret: 'row' }]);
    const response = await operator();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { database: 'ok', livekit: 'disabled', mail: 'disabled' },
    });
  });
  it('never gives detail when no health token is configured', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', '');
    fixture.query.mockResolvedValue([]);
    expect(await (await operator('')).json()).toEqual({ status: 'ok' });
    expect(hasHealthToken('Bearer ', { HEALTH_CHECK_TOKEN: '' })).toBe(false);
    expect(hasHealthToken(null, { HEALTH_CHECK_TOKEN: TOKEN })).toBe(false);
    expect(hasHealthToken(`Bearer ${TOKEN}`, { HEALTH_CHECK_TOKEN: TOKEN })).toBe(true);
  });
  it('reports unavailable instead of healthy when a column is missing', async () => {
    fixture.query.mockRejectedValue(
      new Error('Studio.address missing; private connection details'),
    );
    const response = await anonymous();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    const detailed = await (await operator()).json();
    expect(detailed).toEqual({
      status: 'unavailable',
      checks: { database: 'down', livekit: 'disabled', mail: 'disabled' },
    });
    expect(JSON.stringify(detailed)).not.toMatch(/private|Studio/);
  });
  it('returns 503 without hostnames when configured LiveKit is unreachable', async () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://private-host.livekit.test');
    vi.stubEnv('LIVEKIT_API_KEY', 'key');
    vi.stubEnv('LIVEKIT_API_SECRET', 'secret');
    fixture.query.mockResolvedValue([]);
    fixture.listRooms.mockRejectedValue(new Error('connect ECONNREFUSED private-host'));
    const anonymousResponse = await anonymous();
    expect(anonymousResponse.status).toBe(503);
    expect(await anonymousResponse.text()).toBe('{"status":"unavailable"}');
    const text = await (await operator()).text();
    expect(JSON.parse(text).checks.livekit).toBe('down');
    expect(text).not.toMatch(/private-host|livekit.test|key|secret/);
  });
});
