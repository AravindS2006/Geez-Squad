import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { privatePathReason, unsafeTemplateKeys } from './public-file-policy.mjs';

function git(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('Unable to inspect public Git paths.');
  return result.stdout;
}
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const historical = git(['log', '--all', '--format=', '--name-only', '-z'])
  .split('\0')
  .map((file) => file.replace(/^[\r\n]+/, ''))
  .filter(Boolean);
const failures = [];
for (const file of new Set([...tracked, ...historical])) {
  const reason = privatePathReason(file);
  if (reason) failures.push(`${file}: ${reason}`);
}
for (const file of ['.env.example', '.env.production.example']) {
  for (const key of unsafeTemplateKeys(readFileSync(file, 'utf8')))
    failures.push(`${file}: ${key} must be blank or a documented placeholder`);
}
if (failures.length) {
  console.error(
    'Private file boundary check failed (values are withheld):\n' + failures.join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Public file boundaries passed: ${tracked.length} tracked files and all local Git history.`,
  );
}
