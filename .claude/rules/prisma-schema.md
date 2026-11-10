---
paths:
  - "prisma/**"
  - "src/lib/db.ts"
  - "src/lib/db-provider.ts"
  - "scripts/postgres*.mjs"
  - "scripts/ci-postgres.mjs"
---

# Schema and migration rules

- `prisma/schema.prisma` (SQLite provider) is the source of truth.
  `prisma/postgres/schema.prisma` is generated and must not be edited.
- Changes are **additive**: new tables, new nullable or defaulted columns, new indexes.
  Never drop, rename or narrow a column that has shipped. Do a multi-step expand → backfill
  → contract only with explicit approval.
- Each change gets **two** migration directories with the same name:
  `prisma/migrations/<YYYYMMDDHHMMSS>_<snake_name>/migration.sql` (SQLite) and
  `prisma/postgres/migrations/<same>/migration.sql` (PostgreSQL). Use provider-correct SQL
  (for example JSON versus JSONB, DATETIME versus TIMESTAMP(3)). Committed migrations are
  immutable.
- Never run `prisma migrate reset` or `db push`, and never regenerate the initial migration.
- Production migrations run only in an authorized release step (`docs/DEPLOYMENT.md`).
- Evidence: the isolated runner `build` (applies the SQLite migrations), relevant unit
  tests, and the CI `postgres-coaching` job for PostgreSQL (`scripts/ci-postgres.mjs` runs
  only in GitHub Actions). A passing SQLite check alone is insufficient. Use the `schema-change` skill.
