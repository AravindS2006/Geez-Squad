---
name: domain-review
description: Review the current Geez Squad diff with the project's specialist reviewers (authorization, camera/counting contract, schema, UI layout) chosen by which files changed. Use before opening a PR or when asked to review project-specific risks. Complements the generic /code-review.
argument-hint: "[base branch, default master]"
---

# Domain review of the current diff

1. The base branch is `$ARGUMENTS` (use `master` when that is empty). Find the changed files
   with `git diff --name-only $(git merge-base HEAD <base>)` plus `git status --porcelain`.
2. Pick reviewers by path. Run the ones that apply **in parallel** as subagents and give
   each the base branch and the list of changed files in its area:

   | Changed paths | Reviewer |
   | --- | --- |
   | `src/app/api/**`, `src/lib/*-access.ts`, `security.ts`, `video-grants.ts`, `workspace.ts`, `studio-team.ts`, `session-management.ts` | `authz-auditor` |
   | `camera-*`, `pose-*`, `rep-events`, `exercise-profiles`, `workout-player`, `coach-monitor`, `use-camera-layout`, `public/pose-worker.js`, `studio.tsx` | `camera-contract-reviewer` |
   | `*.css`, `src/components/**/*.tsx`, `src/app/**/page.tsx`, `layout.tsx` | `ui-layout-reviewer` |
   | `prisma/**` | review it yourself against `.claude/rules/prisma-schema.md`: additive only, paired directories with identical names, provider-correct SQL, no edits to committed migrations |

3. Also check the spec boundary yourself. For every changed file, ask "is this required by
   the spec?" and list any that are not.
4. Merge the results into one list ranked by severity: **must fix** (contract, security or
   data-loss), **should fix**, and **out of scope** (noticed, not touched). Drop findings you
   cannot tie to a `file:line` in this diff.
5. Do not apply fixes unless the user asks. End by asking which ones to fix.
