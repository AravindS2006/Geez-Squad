/**
 * Runtime database provider. Production requires DATABASE_PROVIDER=postgresql
 * (see scripts/production-config.mjs); every other configuration uses the local
 * SQLite client, which has a single writer.
 */
export type DatabaseProvider = 'postgresql' | 'sqlite';
export function databaseProvider(env: Record<string, string | undefined> = process.env) {
  return (env.DATABASE_PROVIDER === 'postgresql' ? 'postgresql' : 'sqlite') as DatabaseProvider;
}
export function isSqliteDatabase(env: Record<string, string | undefined> = process.env) {
  return databaseProvider(env) === 'sqlite';
}
