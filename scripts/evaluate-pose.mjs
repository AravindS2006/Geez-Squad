import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

// Exit codes: 1 = replay test failure, 2 = release gates incomplete.
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const manifest = args[0];
if (!manifest)
  throw new Error(
    'Usage: node scripts/evaluate-pose.mjs <local-manifest.json> [report.json] [--release-gates] [--exercises=id,id]',
  );
const output = resolve(args[1] ?? 'test-results/pose-evaluation.json');
const required = (
  process.argv.find((arg) => arg.startsWith('--exercises='))?.slice('--exercises='.length) ?? ''
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/pose-replay.test.ts', '--maxWorkers=1'],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, GEEZ_POSE_MANIFEST: resolve(manifest), GEEZ_POSE_REPORT: output },
  },
);
if (result.status !== 0) process.exit(1);
console.log(`Local replay evidence saved to ${output}. No data was uploaded.`);
if (process.argv.includes('--release-gates')) {
  const report = JSON.parse(await readFile(output, 'utf8'));
  const percent = (value) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);
  console.log(`\nRelease gates (rules ${report.ruleVersion ?? 'unknown'})`);
  console.table(
    report.groups.map((group) => ({
      group: group.group,
      participants: group.participants,
      reps: group.repetitions,
      sets: group.sets,
      negatives: group.negatives,
      precision: percent(group.precision),
      recall: percent(group.recall),
      exactSets: percent(group.exactSets),
      holds1s: percent(group.holdsWithinOneSecond),
      result: group.releaseReady ? 'pass' : `fail: ${group.failedGates.join(', ')}`,
    })),
  );
  // An exercise absent from the manifest has no evidence; it must not pass silently.
  const covered = new Set(report.groups.map((group) => group.exercise));
  const missing = required.filter((id) => !covered.has(id));
  if (missing.length) console.error(`No evaluation groups for: ${missing.join(', ')}`);
  if (
    !report.groups.length ||
    missing.length ||
    report.groups.some((group) => !group.releaseReady)
  ) {
    console.error(
      'Accuracy, coverage, negative-case, physical-device or rule-version gates remain incomplete. Keep these profiles beta.',
    );
    process.exit(2);
  }
  console.log(
    'Every evaluated group passed. Promotion still requires a reviewed release decision.',
  );
}
