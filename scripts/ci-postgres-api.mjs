import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { withDisposablePostgres } from './ci-postgres-container.mjs';

// Runs the API, role, studio, coaching, next-phase and account suites against a production build
// that uses PostgreSQL (the production provider) instead of SQLite. GitHub Actions only: the
// database is a throwaway loopback container and every credential is generated for this run.
const suites = [
  'test-api',
  'test-studio-roles',
  'test-studio-operations',
  'test-coaching-phase',
  'test-next-phase',
  'test-account-lifecycle',
];
const only = process.argv.slice(2);

await withDisposablePostgres(async (url) => {
  const authSecret = randomBytes(48).toString('hex');
  console.log(`::add-mask::${authSecret}`);
  const env = {
    ...process.env,
    DATABASE_PROVIDER: 'postgresql',
    DATABASE_URL: url.href,
    DIRECT_URL: url.href,
    // Lets the fixture guards (scripts/disposable-database.mjs) accept this loopback database.
    GEEZ_DISPOSABLE_POSTGRES: '1',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: authSecret,
    EMAIL_DELIVERY: 'test',
    LIVEKIT_URL: '',
    LIVEKIT_API_KEY: '',
    LIVEKIT_API_SECRET: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    RESEND_API_KEY: '',
    LOG_LEVEL: 'error',
    // Same operator allow-list as scripts/local-coaching-check.mjs; the account suite
    // approves a studio request as this operator.
    PLATFORM_OPERATOR_EMAILS: 'platform-operator@example.test',
  };
  const run = (args, label) => {
    const child = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
    if (child.status !== 0) throw new Error(`${label} failed.`);
  };
  const prisma = (...args) =>
    run(
      ['node_modules/prisma/build/index.js', ...args, '--schema=prisma/postgres/schema.prisma'],
      `prisma ${args.join(' ')}`,
    );

  run(['scripts/postgres.mjs', 'migrate'], 'PostgreSQL migrate deploy');
  prisma('migrate', 'status');
  run(['scripts/postgres.mjs', 'generate'], 'PostgreSQL client generation');
  run(['scripts/prepare-assets.mjs'], 'Asset preparation');
  run(['node_modules/next/dist/bin/next', 'build'], 'Production build');

  const server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'],
    { env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
  );
  const failed = [];
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60 && !healthy; attempt++) {
      healthy = await fetch('http://localhost:3000/api/health')
        .then((response) => response.ok)
        .catch(() => false);
      if (!healthy) await setTimeout(1000);
    }
    if (!healthy) throw new Error('The PostgreSQL-backed server did not become healthy.');
    for (const suite of suites.filter((name) => !only.length || only.includes(name))) {
      console.log(`::group::${suite} (PostgreSQL)`);
      const child = spawnSync(process.execPath, [`scripts/${suite}.mjs`], {
        env,
        stdio: 'inherit',
        windowsHide: true,
        timeout: 15 * 60000,
      });
      console.log('::endgroup::');
      if (child.status !== 0) {
        failed.push(suite);
        console.log(`::error::${suite} failed against PostgreSQL`);
      }
    }
  } finally {
    server.kill();
  }
  if (failed.length) throw new Error(`Failed against PostgreSQL: ${failed.join(', ')}`);
  console.log('All PostgreSQL API suites passed.');
});
