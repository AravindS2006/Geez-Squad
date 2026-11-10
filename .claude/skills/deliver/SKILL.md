---
name: deliver
description: Prepare a Geez Squad change for a pull request - security scan, final checks, commit on a feature branch, and a PR body filled from .github/pull_request_template.md with the checks actually run.
argument-hint: "[pr title]"
disable-model-invocation: true
---

# Deliver the current change

Title hint: $ARGUMENTS

1. **Branch**: if on `master`, create `feat/<slug>` or `fix/<slug>` from the spec's one
   sentence. Never commit to or push `master`.
2. **Scope check**: run `git status --porcelain` and `git diff --stat`. Every changed file
   must be required by the spec. Ask about anything else (it may be the user's own work, so
   do not revert it silently). `AGENTS.md` changes from the `next dev` generated block are
   expected and may be committed.
3. **Checks**: run the `verify` skill if it has not run on the current tree. Then run
   `npm run security:scan` and `npm run security:files`. Stop on any failure.
4. **Commit**: stage only the spec's files by name (never `git add -A`). Use an imperative
   subject (at most 72 characters) and a body explaining why. End with the attribution line
   required by the session.
5. **PR body**: fill `.github/pull_request_template.md`:
   - What and why: one sentence.
   - Spec / done means: the confirmed spec lines, ticked only if verified.
   - Checks actually run: tick only commands that ran and passed in this tree. Write
     results inline (for example "unit: 412 passed").
   - Known limits: real device, PostgreSQL, hosted environment or physical accuracy,
     whichever applies.
6. **Publish only on the user's go-ahead**: show the commit and the PR body, then ask. On
   yes, `git push -u origin <branch>` (the pre-push guard runs; never bypass it) and
   `gh pr create --base master`.
