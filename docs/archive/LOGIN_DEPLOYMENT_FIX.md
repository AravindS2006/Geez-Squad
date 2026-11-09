# Production login repair — 19 October 2026

The `public view` commit, `469c3c0b24778a741abfa987aedf664705f3039e`, was present on GitHub `master` and was the commit served by Vercel production. The checkout was clean and all 30 intended studio-management files, including both providers' migrations and the hero asset, were committed.

The release failed after authentication: production `GET /app` returned 500 with Prisma `P2022`, because `Studio.address` did not exist. The database was reachable, so the old `SELECT 1` health endpoint incorrectly reported healthy. Both studio migrations were pending:

- `20261019000000_studio_operations`
- `20261019010000_studio_classes`

The committed migrations were rehearsed in a temporary isolated PostgreSQL schema using legacy account/session fixtures. The rehearsal checked credential and session preservation, empty defaults for the new studio columns, new membership/payment/booking records, attendance uniqueness, and account/studio deletion cascades. The temporary schema was removed.

Both additive migrations were then applied to the existing production database. Internal preservation fingerprints confirmed that every pre-existing account password hash and user profile/role was unchanged. No existing account was reset or recreated. Temporary preservation fingerprints were removed.

Canonical production acceptance passed 25 checks using a single disposable test account: sign up, onboard, sign out, sign in to that existing account again, read its session, render `/app` without a login redirect, read the workspace and operations, save a plan/member/term/payment/attendance record, sign in again and reload the workspace. Only that disposable account and its studio data were removed afterward.

## Prevention

`npm run build:vercel` now runs a read-only migration-readiness gate before generating the production Prisma client and building the app. Pending, failed, unexpected, or inaccessible migration status blocks the build. Diagnostics identify migration names without printing connection details. Builds never apply migrations automatically.

The health endpoint validates the studio schema needed by the application using a zero-row query. Missing columns/tables return 503 with `Cache-Control: no-store`, without disclosing schema details or reading member records.

For later schema releases, rehearse and apply the committed PostgreSQL migrations first, run `npm run db:postgres:check` with the intended environment, then build/deploy. A successful Git push or Vercel compilation alone does not establish database readiness.

GitHub Actions for `469c3c0` was queued when inspected. That state was not treated as a passed check; the repair was verified locally and against the canonical production domain.

The preventive fix passed 338 unit tests, 51 local studio API checks, and seven browser cases covering real owner signup, trainee invitation/class completion, protected entry, the persisted mobile studio workflow, and accessibility on all ten new pages. The optimized build, TypeScript, formatting and diff checks passed. The new production migration gate was observed blocking the missing migrations before repair and passing after repair.
