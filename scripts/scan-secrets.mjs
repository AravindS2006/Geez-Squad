import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = spawnSync(process.execPath, ['scripts/check-public-files.mjs'], {
  stdio: 'inherit',
  windowsHide: true,
});
if (files.status !== 0) process.exit(files.status ?? 1);
const localScanner = resolve(
  '.vercel/security-tools',
  process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks',
);
const scanner = process.env.GITLEAKS_BIN || (existsSync(localScanner) ? localScanner : 'gitleaks');
const result = spawnSync(
  scanner,
  ['git', '--redact=100', '--no-banner', '--log-opts=--all --full-history -m', '.'],
  { stdio: 'inherit', windowsHide: true },
);
if (result.error)
  console.error(
    'Secret scan unavailable. Install Gitleaks or set GITLEAKS_BIN; the push is blocked.',
  );
process.exitCode = result.status ?? 1;
