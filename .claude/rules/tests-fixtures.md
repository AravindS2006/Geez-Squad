---
paths:
  - "tests/**"
  - "scripts/test-*.mjs"
  - "scripts/check-*.mjs"
  - "scripts/local-*.mjs"
  - "playwright*.config.ts"
  - "vitest.config.ts"
---

# Test and fixture rules

- Run everything through the isolated runner, which has its own SQLite DB, auth secret and
  external services disabled:
  `test-results/runtime22/node.exe scripts/local-coaching-check.mjs <build|dev|serve|unit|api|roles|studio|coaching|next|account|e2e|a11y>`.
  Use `dev` or `serve` in one terminal and the checks in another, with one server at a time.
- Never point fixtures at a hosted URL or a production database, even if credentials are
  present. Accounts use `example.test`, and media is synthetic.
- On Windows, stop the server before `build` or `prisma generate`, because the query engine
  DLL locks.
- Unit tests: `tests/<module>.test.ts` against pure `src/lib/` modules. Route tests use
  `tests/route-mocks.ts`.
- E2E: `tests/e2e/<feature>.spec.ts` with helpers in `tests/e2e/support/`. Playwright uses
  installed Edge. WebKit runs via `e2e --config playwright.webkit.config.ts`.
- Keep runtime and DB helpers out of `test-results/browser-runs` (Playwright cleans it).
  Traces and screenshots stay local.
- A test that only checks a mock returns what the mock was given proves nothing. Assert the
  behavior or contract.
