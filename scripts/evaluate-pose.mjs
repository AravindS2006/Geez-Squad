import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const manifest = args[0];
if (!manifest)
  throw new Error('Usage: node scripts/evaluate-pose.mjs <local-manifest.json> [report.json]');
const output = resolve(args[1] ?? 'test-results/pose-evaluation.json');
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/pose-replay.test.ts', '--maxWorkers=1'],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, GEEZ_POSE_MANIFEST: resolve(manifest), GEEZ_POSE_REPORT: output },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Local replay evidence saved to ${output}. No data was uploaded.`);
if (process.argv.includes('--release-gates')) {
  const report = JSON.parse(await readFile(output, 'utf8'));
  if (!report.groups.length || report.groups.some((group) => !group.releaseReady)) {
    console.error('Accuracy, coverage, negative-case, or physical-device gates remain incomplete.');
    process.exit(2);
  }
}
