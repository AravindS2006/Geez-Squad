# Security and operating notes

Authentication uses Better Auth and Prisma-backed sessions. Password management is delegated to that library. Role setup is server-side and one-time. Every domain API binds the authenticated user to studio ownership or session enrollment. Public sample data is entirely separate from protected records. Mutation endpoints check Origin, JSON format, input size, schema validity, and database-backed request limits. LiveKit JWTs have no room administration or arbitrary data-publish grants.

`EMAIL_DELIVERY=test` is for local and isolated test runs only; the production build guard rejects it, and production uses `smtp`. Signup/sign-in work without verification, the login page labels the limitation, and account emails remain unverified. Mail delivery and recovery requests are disabled even if dormant credentials are present. Keep invitation links private; typed emails do not establish identity in this mode. For closed signup instead, use `EMAIL_DELIVERY=disabled`, which retains verified-account sign-in only. After switching to `smtp` or `resend`, redeploy and test delivered verification and reset links. Existing testing accounts receive verification links on password sign-in; protected APIs reject their existing sessions until verification. See [TESTING_GUIDE.md](TESTING_GUIDE.md).

Use the trusted Vercel proxy for authentication's forwarded-IP rate limiting; self-hosted operators must configure trusted proxy headers correctly. Disable LiveKit Cloud automatic room creation. The application prepares rooms explicitly and revokes identities with a current cutoff before room deletion, including on cleanup retries. Cached-token reconnection is part of the required Cloud service tests, since JWT expiration alone does not close an active/refreshed session. [LiveKit participant revocation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/).

`/api/health` checks database availability without exposing provider credentials or database details. API failures include safe messages and request IDs; error logs contain error type and request ID rather than customer messages or frames. Production browser headers restrict camera/mic to this origin, prevent framing, and include a CSP. The CSP permits inline Next.js bootstrap scripts and WASM compilation; nonce-based CSP is a hardening follow-up, not a completed control.

## Recovery and incidents

1. Check provider status, database connectivity, error IDs, auth verification delivery, and LiveKit room availability.
2. Degrade to human coaching/local camera practice when analysis or media fails. Explain the unavailable measurement rather than display stale assurance.
3. Rotate compromised keys in their providers and redeploy. Revoke affected auth sessions and investigate access audit events.
4. Roll back an application release only to a schema-compatible version. Restore a database from a verified backup into a separate environment and check row counts/access isolation before switching traffic.
5. Follow the published incident/notification process for affected users and markets; qualified review is required for legal obligations.

## Data retention

The cleanup endpoint is cron-secret-protected. Latest metrics: 7 days. Class messages: 90 days. Expired invites, sessions, verification records, and rate records are deleted. Summaries/account/studio records are retained for the operator's declared policy. Audit records contain actor/target IDs and control action but no camera frame data.

Data export returns only the requesting user's own records. Settings → Delete my account (`POST /api/account`, `src/lib/account-deletion.ts`) erases the account after password re-entry and a typed `DELETE` confirmation, rate-limited to five attempts a minute. The user row cascades sign-in, sessions, workouts, check-ins, nutrition, enrollments and messages. Studio-owned member, term, payment, attendance and booking records are retained and unlinked (`userId` set to null). A deleted coach's primary-coach assignments are written to `CoachAssignmentHistory`, hosted upcoming classes fall back to the studio owner, live rooms are revoked, and an `account.deleted` audit event (IDs only) is kept. Studio owners and users with an open subscription are refused with `STUDIO_OWNER` / `BILLING_ACTIVE`; closing a studio remains an operator process because it cascades members and financial records. Do not delete financial records without an approved retention policy.

## Known engineering limits

- Metrics, cues, and control state use 3-second polling rather than a durable realtime bus. Hidden tabs poll every 15 s and refresh immediately when shown; unchanged trainee summaries are re-sent as a 9 s heartbeat (coach freshness window 12 s). The class poll runs its independent reads concurrently. Local detector feedback is immediate. The enrollment ceiling is 100; it is not a verified concurrency guarantee. Load-test the intended PostgreSQL and RTC concurrency before increasing operational class sizes.
- Clients compute their own estimates; the backend validates bounds but cannot attest that they came from an actual camera. They must not be used for competitions, insurance, medical decisions, or fraud-sensitive rewards.
- Scores are heuristic geometry comparisons. The included rule version is `profile-v10`; no validated learned scoring model exists yet. Bridge, crunch, and row have no numeric form score. Keep one trainee in view: the configured single-person tracker cannot reliably reject all extra people.
- Stopping local analysis while a shared camera is active stops inference, not the separately indicated video room stream. Use the room camera toggle or leave video to stop sharing.
- Browser CPU performance, thermal throttling, supported Safari behavior, and live WebRTC reconnection remain to be measured on physical devices.
- Stripe and email integration code needs real service tests. Paid feature entitlements, operator console, studio closure/ownership transfer, push notifications, and coach verification are future milestones. Self-service account deletion and weekly recurring studio classes shipped on 9 November 2026.
- Critical membership/enrollment and metrics operations use serializable transactions. The shared write helper provides bounded serialization-conflict retries and serializes local SQLite writes. Observe retries and failures under PostgreSQL load; local SQLite checks do not establish production concurrency behavior.
- Workspace history is bounded to 100 classes per status, 500 saved sets, and 100 check-ins. Live classes and nearest scheduled classes are selected independently of history. Insights reveals loaded exercise records in batches of 50 and can retry pending device saves. Direct authorized room access is independent of class-list bounds. Backend pagination is still required for complete lifetime history.

See the [12 October codebase audit](archive/CODEBASE_AUDIT_2026-10-12.md) for the latest fixes, evidence, and unresolved acceptance work.

Before production, assess dependency licensing, conduct threat modeling/pentesting, test all service failure states, choose monitoring/alert recipients, and rehearse restores (see below). The included checks are development verification, not an independent security certification.

## Backup and restore

There are two recovery paths. Rehearse both before launch and after any change of database plan.

1. **Neon point-in-time restore** (first choice after a bad migration or accidental delete). In the Neon console, create a branch from the production branch at a time before the incident. Run `node scripts/postgres.mjs check` and `scripts/verify-postgres.mjs` against the branch's direct URL, then inspect the affected records. Only then restore the production branch from it, or repoint Vercel to it. The window you can go back depends on the Neon plan's history retention. Confirm it in the Neon console and record it below. The Free plan carries no SLA.
2. **Logical backup** (an independent copy kept outside Neon). `npm run db:restore:rehearse -- --dump <path outside the repo>.dump` reads `RESTORE_SOURCE_URL` and `RESTORE_TARGET_URL`. It takes a `pg_dump` custom-format backup of the source, restores it into the target and compares exact row counts for every public table, including `_prisma_migrations`. It refuses a pooled (`-pooler`) endpoint, a target that is the source or the app's `DATABASE_URL`/`DIRECT_URL`, a target that already has tables, and a dump path inside the repository that git does not ignore. It never writes to the source and never prints connection strings. It uses `pg_dump`/`pg_restore`/`psql` from PATH, or else Docker (`RESTORE_PG_IMAGE`, default `postgres:17-alpine`). The client major version must be at least the server's.

Production rehearsal steps:

1. Create an empty database on a non-production Neon branch, or in a separate project, and copy its direct URL.
2. Set `RESTORE_SOURCE_URL` to the production direct URL (`DIRECT_URL`) and `RESTORE_TARGET_URL` to the empty database, in the shell only. Run the command above. A table written during the backup is reported as changed, and it passes when its restored count lies between the before and after counts.
3. Point `scripts/postgres.mjs check` and `scripts/verify-postgres.mjs` (with `DATABASE_PROVIDER=postgresql`) at the restored database.
4. Record the date, operator, backup and restore times, table and row totals, and the Neon history window in the log below. Then delete the dump file and the rehearsal database. The dump holds personal data.

`npm run test:restore` proves the script on two disposable Docker databases. It migrates the source with the committed migrations, seeds member, workout and audit rows, restores, and checks each refusal.

| Date | Operator | Path | Backup / restore time | Tables / rows | Neon history window | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-10 | local proof (`npm run test:restore`) | logical, Docker `postgres:17-alpine` | 1.5 s / 2.0 s | 39 / 16 | n/a | pass |
