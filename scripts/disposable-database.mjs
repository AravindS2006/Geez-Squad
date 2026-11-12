/**
 * Fixture scripts write and delete rows directly. They may only target a disposable database:
 * - a local SQLite file (the isolated runner and the Windows CI job), or
 * - a loopback PostgreSQL server that the CI PostgreSQL job started for this run, which it marks
 *   with GEEZ_DISPOSABLE_POSTGRES=1 and DATABASE_PROVIDER=postgresql (scripts/ci-postgres-api.mjs).
 * A hosted database URL never qualifies, whatever flags are set.
 * @param {Record<string, string | undefined>} [env]
 */
export function isDisposableTestDatabase(env = process.env) {
  const url = env.DATABASE_URL ?? '';
  if (url.startsWith('file:')) return env.DATABASE_PROVIDER !== 'postgresql';
  if (env.GEEZ_DISPOSABLE_POSTGRES !== '1' || env.DATABASE_PROVIDER !== 'postgresql') return false;
  try {
    const parsed = new URL(url);
    return (
      ['postgresql:', 'postgres:'].includes(parsed.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function assertDisposableTestDatabase(message = 'Local disposable test database required.') {
  if (!isDisposableTestDatabase()) throw new Error(message);
}
