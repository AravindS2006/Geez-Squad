import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
mkdirSync('test-results', { recursive: true });
const env = {
  ...process.env,
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${resolve('test-results/coaching-phase.db').replaceAll('\\', '/')}`,
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'local-coaching-verification-only-2026-10-24',
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
  TEMP: resolve('test-results'),
  TMP: resolve('test-results'),
  LOG_LEVEL: 'error',
};
function run(args) {
  const child = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (child.status !== 0) process.exit(child.status ?? 1);
}
const action = process.argv[2];
if (action === 'build') {
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  run(['node_modules/prisma/build/index.js', 'generate']);
  run(['scripts/prepare-assets.mjs']);
  run(['node_modules/next/dist/bin/next', 'build']);
} else if (action === 'serve')
  run(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1']);
else if (action === 'e2e')
  run(['node_modules/@playwright/test/cli.js', 'test', '--workers=1', ...process.argv.slice(3)]);
else if (action === 'unit')
  run(['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', ...process.argv.slice(3)]);
else {
  const scripts = {
    api: 'test-api',
    roles: 'test-studio-roles',
    studio: 'test-studio-operations',
    coaching: 'test-coaching-phase',
    next: 'test-next-phase',
    a11y: 'check-accessibility',
  };
  if (!scripts[action])
    throw new Error('Choose build, serve, unit, api, roles, studio, coaching, next, e2e, or a11y.');
  run([`scripts/${scripts[action]}.mjs`]);
}
