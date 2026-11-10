---
name: verify
description: Run the right Geez Squad checks for the current diff (typecheck, lint, format, unit, isolated-runner API/role/coaching checks, e2e, a11y) and report exact results. Use after implementing a change, before saying something works, or when asked to test/verify/check.
argument-hint: "[quick|full]"
---

# Verify the current change

Mode: `$ARGUMENTS` (empty means choose by diff). `quick` runs typecheck, lint, format and
the affected unit tests only. `full` runs everything relevant, including server-backed and
e2e checks.

Delegate to the `verifier` subagent so long logs stay out of this conversation. Pass it the
mode and one sentence on what changed and why. If subagents are unavailable, follow
`.claude/agents/verifier.md` yourself.

When it returns:

- Relay the results table as-is. Do not upgrade "not run" or "flaky" to "pass".
- For each failure, read the cited `file:line` and decide whether the change caused it. If
  it did, fix it and re-run only that check. Call a failure pre-existing only with evidence
  (the same failure in a clean `git worktree add` of the base branch, or a failing test
  and code path the diff does not touch). Never stash or reset the user's work to check.
- Lint: the warning count must not exceed the `--max-warnings` cap in `package.json` and
  must not increase compared with before your change.
- End with **Not verified**: real phone or iPhone Safari, PostgreSQL (CI `postgres-coaching`),
  a hosted environment, or a 36-trainee LiveKit soak, whichever applies.
