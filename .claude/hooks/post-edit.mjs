// PostToolUse(Edit|Write|MultiEdit): format the edited file with the project's
// Prettier (same globs as `npm run format`) and flag unpaired schema changes.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { addContext, projectDir, projectPath, readInput } from './lib.mjs';

const input = await readInput();
const rel = projectPath(input.tool_input?.file_path);
if (!rel) process.exit(0);
const notes = [];

const formatted =
  /^src\/.+\.(ts|tsx|css|mjs)$/.test(rel) ||
  /^tests\/.+\.ts$/.test(rel) ||
  /^scripts\/[^/]+\.mjs$/.test(rel) ||
  /^[^/]+\.(json|ts|mjs)$/.test(rel) ||
  rel === 'public/pose-worker.js';
const prettier = resolve(projectDir, 'node_modules/prettier/bin/prettier.cjs');
if (formatted && existsSync(prettier)) {
  const run = spawnSync(process.execPath, [prettier, '--write', '--log-level', 'warn', rel], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 20000,
  });
  if (run.status !== 0)
    notes.push(
      `Prettier could not format ${rel} (likely a syntax error): ${(run.stderr || '').trim().slice(0, 600)}`,
    );
}

// Paired migrations: every migration directory after the last historical one
// (20261024030000_operation_corrections) must exist for both providers. Older
// directories predate the pairing rule and intentionally differ.
const pairs = (dir) => {
  const full = resolve(projectDir, dir);
  return existsSync(full)
    ? readdirSync(full, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
};
if (rel === 'prisma/schema.prisma')
  notes.push(
    'prisma/schema.prisma changed. Schema changes need an additive migration in BOTH prisma/migrations/<ts>_<name>/ and prisma/postgres/migrations/<ts>_<name>/ (same directory name). Follow the schema-change skill.',
  );
if (/^prisma\/(postgres\/)?migrations\//.test(rel) || rel === 'prisma/schema.prisma') {
  const sqlite = pairs('prisma/migrations');
  const postgres = pairs('prisma/postgres/migrations');
  const newest = sqlite.filter((n) => n > '20261024030000');
  const missing = [
    ...newest.filter((n) => !postgres.includes(n)).map((n) => `prisma/postgres/migrations/${n}`),
    ...postgres
      .filter((n) => n > '20261024030000' && !sqlite.includes(n))
      .map((n) => `prisma/migrations/${n}`),
  ];
  if (missing.length)
    notes.push(`Unpaired migration directories, still to create: ${missing.join(', ')}.`);
}

if (notes.length) addContext('PostToolUse', notes.join('\n'));
