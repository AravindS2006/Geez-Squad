import { spawnSync } from 'node:child_process';

/** Read-only release gate. Never apply migrations as a side effect of a build. */
export function checkPostgresReadiness(env = process.env, run = spawnSync) {
  if (!env.DIRECT_URL || !env.DATABASE_URL) {
    return { ok: false, message: 'PostgreSQL readiness requires DATABASE_URL and DIRECT_URL.' };
  }
  const result = run(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'status',
      '--schema=prisma/postgres/schema.prisma',
    ],
    {
      env: { ...env, DATABASE_PROVIDER: 'postgresql' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0 && /database schema is up to date/i.test(output)) {
    return { ok: true, message: 'PostgreSQL migration history matches this release.' };
  }
  // CLI diagnostics may contain connection details; report actionable names only.
  const pending = [...new Set(output.match(/\b\d{14}_[a-z0-9_]+\b/gi) || [])];
  return {
    ok: false,
    message:
      'PostgreSQL is not ready for this release. Apply and verify the committed PostgreSQL migrations before deploying.' +
      (pending.length
        ? ` Migrations: ${pending.join(', ')}.`
        : ' Check database connectivity and migration status in the secure release environment.'),
  };
}
