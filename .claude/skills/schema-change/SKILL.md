---
name: schema-change
description: Make an additive Prisma schema change in Geez Squad with paired SQLite and PostgreSQL migrations and verify both. Use whenever prisma/schema.prisma must change (new model, column, index, relation).
argument-hint: "<what the data change is for>"
---

# Additive schema change with paired migrations

Purpose: $ARGUMENTS

1. **Design**: additive only (new model, nullable or defaulted column, index). If the request
   implies dropping, renaming or narrowing, stop and propose expand → backfill → contract
   for approval.
2. **Edit** `prisma/schema.prisma`, which is the only schema you edit. The PostgreSQL schema
   is generated.
3. **Name**: `<UTC YYYYMMDDHHMMSS>_<snake_case>`, later than every existing directory in both
   `prisma/migrations/` and `prisma/postgres/migrations/`.
4. **SQLite migration**: generate the SQL offline from the previous schema, without touching
   any DB:
   `git show HEAD:prisma/schema.prisma > test-results/schema.before.prisma`, then
   `npx prisma migrate diff --from-schema-datamodel test-results/schema.before.prisma --to-schema-datamodel prisma/schema.prisma --script`.
   Save the output to `prisma/migrations/<name>/migration.sql`.
5. **PostgreSQL migration**: run `node scripts/postgres.mjs generate` (regenerates the ignored
   PG schema), then repeat the diff against a PG copy of the before-schema (provider
   `postgresql`) and save the output to `prisma/postgres/migrations/<name>/migration.sql`.
   Read both files. Types must be provider-correct (for example `JSONB` and `TIMESTAMP(3)` in
   PG). No `DROP`.
6. **Code**: update types and zod schemas, keep legacy rows valid (don't invent semantics for
   old records), and make readers tolerate null.
7. **Verify**:
   - `test-results/runtime22/node.exe scripts/local-coaching-check.mjs build` applies the
     SQLite migrations from scratch. Stop any dev server first on Windows.
   - Unit tests touching the model.
   - PostgreSQL: `node scripts/ci-postgres.mjs` if a local Docker or PostgreSQL is available,
     otherwise report "PostgreSQL: CI job postgres-coaching (not run locally)".
8. Never apply anything to a hosted database. Production migration is a separate,
   user-authorized release step (`docs/DEPLOYMENT.md`).
