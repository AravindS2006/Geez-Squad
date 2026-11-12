import { spawnSync } from 'node:child_process';
import { withDisposablePostgres } from './ci-postgres-container.mjs';

// No production credentials or repository secrets are needed by this job.
await withDisposablePostgres(async (testUrl) => {
  const rehearsal = spawnSync(process.execPath, ['scripts/rehearse-coaching-postgres.mjs'], {
    env: { ...process.env, POSTGRES_TEST_URL: testUrl.href },
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120000,
  });
  if (rehearsal.status !== 0) throw new Error('Disposable PostgreSQL migration checks failed.');
});
