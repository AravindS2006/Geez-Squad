import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

/**
 * Start a throwaway PostgreSQL container bound to loopback with a password generated for this
 * run, call `callback(url)`, then remove the container. No credential is committed or passed as a
 * command-line argument, and GitHub Actions masks it in logs. GitHub Actions only.
 */
export async function withDisposablePostgres(callback) {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('This disposable database runner is for GitHub Actions only.');
  const password = randomBytes(32).toString('hex');
  const container = `geez-postgres-${randomUUID()}`;
  console.log(`::add-mask::${password}`);
  function docker(args) {
    return spawnSync('docker', args, {
      env: { ...process.env, POSTGRES_PASSWORD: password },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
    });
  }
  try {
    // Docker forwards the environment by name; the credential is never an argument.
    const started = docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD',
      'postgres:17-alpine',
    ]);
    if (started.status !== 0) throw new Error('Could not start the disposable test database.');
    const port = docker(['port', container, '5432/tcp'])
      .stdout?.trim()
      .match(/^127\.0\.0\.1:(\d+)$/)?.[1];
    if (!port) throw new Error('The test database must bind only to loopback.');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (
        docker(['exec', container, 'pg_isready', '--host', '127.0.0.1', '--username', 'postgres'])
          .status === 0
      ) {
        ready = true;
        break;
      }
      await setTimeout(1000);
    }
    if (!ready) throw new Error('The test database did not become ready.');
    const url = new URL(`postgresql://postgres@127.0.0.1:${port}/postgres`);
    url.password = password;
    console.log(`::add-mask::${url.href}`);
    return await callback(url);
  } finally {
    if (docker(['rm', '--force', container]).status !== 0)
      console.warn('Database cleanup did not complete; the disposable runner will be destroyed.');
  }
}
