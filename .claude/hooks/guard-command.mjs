// PreToolUse(Bash|PowerShell): stop commands that leak secrets, touch production,
// bypass the pre-push guard, or rewrite database history. Literal pattern checks:
// false positives are acceptable, the reason tells Claude what to do instead.
import { spawnSync } from 'node:child_process';
import { ask, block, projectDir, readInput } from './lib.mjs';

const input = await readInput();
const cmd = String(input.tool_input?.command || '');
if (!cmd) process.exit(0);
const has = (re) => re.test(cmd);

// 1. Secret exposure.
const secretFile =
  /(^|[\s"'/\\=])\.env(\.(local|production|development|test)(\.local)?)?(?![\w.-])/;
if (
  has(
    /\b(cat|type|more|less|head|tail|gc|get-content|sed|awk|grep|rg|findstr|select-string|bat)\b/i,
  ) &&
  has(secretFile)
)
  block(
    'Do not print .env files. Check keys/status only (e.g. node -e that reports which keys are set, never values).',
  );
if (has(/^\s*(printenv|env|set|export -p)\s*$/im) || has(/\b(gci|get-childitem|dir|ls)\s+env:/i))
  block('Do not dump the environment. Check a single variable for presence, never its value.');
if (
  has(
    /\b(echo|printf|write-host|write-output|console\.log)\b[^|;&]*\$(env:)?\{?(DATABASE_URL|DIRECT_URL|BETTER_AUTH_SECRET|LIVEKIT_API_(KEY|SECRET)|STRIPE_\w+|SMTP_PASSWORD|RESEND_API_KEY)/i,
  )
)
  block('Do not print secret environment values.');
if (has(/\bvercel(@[\d.]+)?\s+env\s+(pull|ls|get)\b/i))
  block('Do not pull or list production environment values (docs/DEPLOYMENT.md).');

// 2. Guard bypasses and history rewrites.
if (has(/\bgit\b[^\n]*\s--no-verify\b/) || has(/\bgit\s+commit\b[^\n]*\s-n\b/))
  block(
    'Never bypass git hooks (AGENTS.md: never bypass the pre-push guard). Fix what the hook reports.',
  );
if (has(/\bcore\.hooksPath\b/) && !has(/core\.hooksPath\s+\.githooks\b/))
  block('Do not repoint core.hooksPath away from .githooks.');
if (has(/\bgit\s+push\b[^\n]*(\s--force(?!-with-lease)\b|\s-f\b|\s\+\S)/))
  block('Force push is not allowed. Use a new commit, or ask the user to do it themselves.');
if (has(/\bgit\s+push\b/)) {
  const branch = spawnSync('git', ['branch', '--show-current'], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  const onDefault = /^(master|main)$/.test((branch.stdout || '').trim());
  if (
    has(/\bgit\s+push\b[^\n]*\s(\S+:)?(master|main)(\s|$)/) ||
    (onDefault && !has(/\bgit\s+push\b[^\n]*\s\S+\s+\S+/))
  )
    block('Do not push to master directly. Create a feature branch, push it, and open a PR.');
}

// 3. Database history.
if (has(/\bprisma\b[^\n]*\bmigrate\s+reset\b/) || has(/\bprisma\b[^\n]*\bdb\s+push\b/))
  block(
    'prisma migrate reset / db push bypass the paired migration history. Write additive migrations (schema-change skill).',
  );
if (
  has(/\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bTRUNCATE\b/i) &&
  has(/\b(prisma|psql|sqlite3|execute)\b/i)
)
  block('Destructive SQL is not allowed from the agent. Schema changes are additive.');

// 4. Production / hosted targets.
const fixture =
  /scripts[\\/](test-[\w-]+|check-accessibility|local-studio-fixture|evaluate-pose|capture-preview)\.mjs|\bplaywright\s+test\b|\bnpm\s+run\s+test:/;
if (has(fixture) && has(/vercel\.app|geez-squad\.|\.env\.production|--env-file/i))
  block(
    'Fixture/test scripts run only against the isolated local runner (node scripts/local-coaching-check.mjs <check>), never a hosted URL or production env.',
  );
if (
  has(/\bscripts[\\/]postgres\.mjs\s+migrate\b/) ||
  has(/\bnpm\s+run\s+db:(postgres:migrate|members:backfill|roles:backfill)\b/)
)
  ask(
    'This applies migrations/backfills to the database in the current environment. Confirm the target is not production unless this release was explicitly authorized.',
  );
if (
  has(/\bvercel(@[\d.]+)?\b[^\n]*\b(deploy|promote|alias|rollback|remove|rm)\b/i) ||
  has(/\bvercel(@[\d.]+)?\s+--prod\b/i)
)
  ask(
    'This changes a Vercel deployment. Confirm the user authorized this release (docs/DEPLOYMENT.md).',
  );
if (has(/\bgh\s+(pr\s+merge|release\s+create|repo\s+(delete|edit))\b/))
  ask('This is an outward-facing GitHub change. Confirm before running.');
