import { describe, expect, it } from 'vitest';
import { isDisposableTestDatabase } from '../scripts/disposable-database.mjs';

// Credentials are set through the URL API at runtime, so the source holds no
// username/password pair that secret scanners would flag (same as rehearse-restore.test.ts).
function pg(host: string) {
  const url = new URL(`postgresql://${host}:5432/sampledb`);
  url.username = 'sample-user';
  url.password = ['sample', 'run'].join('-');
  return url.href;
}
const ciPostgres = { DATABASE_PROVIDER: 'postgresql', GEEZ_DISPOSABLE_POSTGRES: '1' };

describe('fixture database guard', () => {
  it('accepts a local SQLite file', () => {
    expect(isDisposableTestDatabase({ DATABASE_URL: 'file:./test-results/x.db' })).toBe(true);
    expect(
      isDisposableTestDatabase({ DATABASE_URL: 'file:./x.db', DATABASE_PROVIDER: 'sqlite' }),
    ).toBe(true);
  });

  it('accepts loopback PostgreSQL only when the CI job marked it disposable', () => {
    expect(isDisposableTestDatabase({ ...ciPostgres, DATABASE_URL: pg('127.0.0.1') })).toBe(true);
    expect(isDisposableTestDatabase({ ...ciPostgres, DATABASE_URL: pg('localhost') })).toBe(true);
    expect(
      isDisposableTestDatabase({ DATABASE_PROVIDER: 'postgresql', DATABASE_URL: pg('127.0.0.1') }),
    ).toBe(false);
    expect(
      isDisposableTestDatabase({ GEEZ_DISPOSABLE_POSTGRES: '1', DATABASE_URL: pg('127.0.0.1') }),
    ).toBe(false);
  });

  it('never accepts a hosted database, whatever flags are set', () => {
    expect(isDisposableTestDatabase({ ...ciPostgres, DATABASE_URL: pg('db.example.test') })).toBe(
      false,
    );
    expect(
      isDisposableTestDatabase({ ...ciPostgres, DATABASE_URL: pg('127.0.0.1.example.test') }),
    ).toBe(false);
    expect(isDisposableTestDatabase({ ...ciPostgres, DATABASE_URL: 'not a url' })).toBe(false);
    expect(isDisposableTestDatabase({})).toBe(false);
  });

  it('rejects a SQLite URL paired with the PostgreSQL provider', () => {
    expect(isDisposableTestDatabase({ ...ciPostgres, DATABASE_URL: 'file:./x.db' })).toBe(false);
  });
});
