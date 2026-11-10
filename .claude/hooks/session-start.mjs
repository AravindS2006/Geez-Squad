// SessionStart: a few facts Claude would otherwise re-derive. Plain stdout is
// added to the session context, so keep it short and never print env values.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectDir } from './lib.mjs';

const git = (...args) =>
  (spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' }).stdout || '').trim();
const branch = git('branch', '--show-current') || '(detached)';
const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
const [major, minor] = process.versions.node.split('.').map(Number);
const pinned = 'test-results/runtime22/node.exe';
const lines = [
  `Geez Squad session: branch ${branch}, ${dirty} uncommitted path(s)${dirty ? " (preserve the user's work; read git diff before editing)" : ''}.`,
];
if (/^(master|main)$/.test(branch))
  lines.push(
    'On the default branch: create a feature branch before committing (one spec, one PR).',
  );
if (major !== 22 || minor < 22)
  lines.push(
    existsSync(resolve(projectDir, pinned))
      ? `PATH node is ${process.versions.node}; the project needs ^22.22. Run project scripts with ${pinned} (e.g. ${pinned} scripts/local-coaching-check.mjs unit).`
      : `PATH node is ${process.versions.node}; the project needs ^22.22. Say so in the delivery note if checks run on another version.`,
  );
process.stdout.write(lines.join('\n') + '\n');
