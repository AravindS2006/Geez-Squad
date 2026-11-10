# Claude Code primitives for Geez Squad

Committed, project-scoped configuration. Personal overrides go in
`.claude/settings.local.json` (ignored). `launch.json` and `worktrees/` are local-only.

| Primitive | Path | Purpose |
| --- | --- | --- |
| Memory | `CLAUDE.md` → `@AGENTS.md` | Shared agent entry point plus the Claude-specific index |
| Output style | `output-styles/geez-engineer.md` | Literal-minded engineer persona (set in `settings.json`, with coding instructions kept) |
| Path rules | `rules/*.md` | Contracts loaded only when matching files are touched: `camera-pose`, `api-authorization`, `prisma-schema`, `ui-layout`, `tests-fixtures` |
| Skills | `skills/<name>/SKILL.md` | `/prompt-architect` (plain request → XML prompt with positive constraints, then executes), `/spec`, `/verify`, `/domain-review`, `/deliver` (manual only), `/api-route`, `/schema-change`, `/next-docs`, `/ui-change` |
| Subagents | `agents/*.md` | `system-architect` (design), `authz-auditor`, `camera-contract-reviewer`, `ui-layout-reviewer` (reviews, read-only), `verifier` (runs checks) |
| Hooks | `hooks/*.mjs` via `settings.json` | See below |
| Permissions | `settings.json` | Allow read-only git and project checks, ask before push or deploy, deny reading secret env files |

## Hooks

All hooks are dependency-free Node scripts (they run on PATH `node`, any 18+).

| Event | Script | Behavior |
| --- | --- | --- |
| SessionStart | `session-start.mjs` | Branch, dirty count, a warning when on `master`, and a Node <22.22 warning pointing to `test-results/runtime22/node.exe` |
| PreToolUse Bash/PowerShell | `guard-command.mjs` | **Blocks**: printing `.env`/env dumps/secret vars, `vercel env pull`, `--no-verify`, repointing `core.hooksPath`, force push, push to `master`, `prisma migrate reset`/`db push`, destructive SQL, and fixtures against hosted or production targets. **Asks**: `postgres.mjs migrate`, member/role backfills, Vercel deploy/promote/alias, `gh pr merge` |
| PreToolUse Read/Edit/Write | `guard-files.mjs` | Blocks secret files (`.env*` except `*.example`, keys, `.vercel/`), edits to generated files (`prisma/postgres/schema.prisma`, `public/models\|wasm\|vision`, lockfile, build output), and edits to **committed** migrations |
| PostToolUse Edit/Write | `post-edit.mjs` | Runs Prettier on files in `npm run format` scope, reports syntax errors, and flags unpaired SQLite/PostgreSQL migration directories |

Test a hook by piping JSON to it, for example:

```sh
echo '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}' | node .claude/hooks/guard-command.mjs; echo "exit $?"
```

Exit 2 means blocked (the reason goes to Claude). JSON on stdout means ask, or extra context.

## Maintaining

- When a contract in `docs/AI_HANDOFF.md` changes, update the matching `rules/*.md` and
  reviewer agent in the same PR.
- Keep rules short: they load into context whenever matching files are read.
- New hook patterns must explain in their reason what to do instead.
