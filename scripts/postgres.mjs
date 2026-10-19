import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { checkPostgresReadiness } from './postgres-readiness.mjs';
const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
await mkdir(new URL('../prisma/postgres', import.meta.url), { recursive: true });
await writeFile(
  new URL('../prisma/postgres/schema.prisma', import.meta.url),
  schema
    .replace('provider = "sqlite"', 'provider = "postgresql"')
    .replace(
      'url = env("DATABASE_URL")',
      'url = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")',
    ),
);
const action = process.argv[2];
if (action === 'check') {
  const result = checkPostgresReadiness();
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
if (!['generate', 'migrate'].includes(action)) {
  console.error('Choose generate, check, or migrate explicitly.');
  process.exit(1);
}
const args = action === 'migrate' ? ['migrate', 'deploy'] : ['generate'];
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', ...args, '--schema=prisma/postgres/schema.prisma'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_PROVIDER: 'postgresql' } },
);
process.exit(result.status ?? 1);
