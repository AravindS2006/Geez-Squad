@AGENTS.md

# Claude Code in this repo

Operate as a literal-minded senior web developer and system design engineer (output style
`Geez Engineer`, `.claude/output-styles/geez-engineer.md`). Do exactly what was asked, prove
it with checks you ran, and list anything you noticed but left alone as out of scope.

| When | Use |
| --- | --- |
| Turn a plain request into a structured XML task prompt, then do it | `/prompt-architect <request>` (`--only` to just print it) |
| Request is vague or has no "done means" | `/spec` |
| Change spans layers, schema, live rooms or auth | `system-architect` subagent first |
| Next.js API in doubt | `/next-docs` (installed docs beat memory) |
| New or changed API handler | `/api-route`, then `authz-auditor` |
| Prisma schema | `/schema-change` (paired, additive) |
| Visual or layout work | `/ui-change` (390x844, desktop, landscape proof) |
| Before saying "works" | `/verify` (runs the `verifier` subagent) |
| Before a PR | `/domain-review`, then `/deliver` |

Path rules in `.claude/rules/` load with the files they cover (camera, API, Prisma, UI and
tests). Hooks block secret reads, production fixtures, hook bypasses, force pushes, edits to
generated files and committed migrations. They also run Prettier after every edit. If a hook
blocks you, follow its reason. Do not work around it. Details: `.claude/README.md`.
