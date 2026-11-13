# Security and operating notes

Authentication uses Better Auth and Prisma-backed sessions. Password management is delegated to that library. Role setup is server-side and one-time. Every domain API binds the authenticated user to studio ownership or session enrollment. Public sample data is entirely separate from protected records. Mutation endpoints check Origin, JSON format, input size, schema validity, and database-backed request limits. LiveKit JWTs have no room administration or arbitrary data-publish grants.

`EMAIL_DELIVERY=test` is for local and isolated test runs only; the production build guard rejects it, and production uses `smtp`. Signup/sign-in work without verification, the login page labels the limitation, and account emails remain unverified. Mail delivery and recovery requests are disabled even if dormant credentials are present. Keep invitation links private; typed emails do not establish identity in this mode. For closed signup instead, use `EMAIL_DELIVERY=disabled`, which retains verified-account sign-in only. After switching to `smtp` or `resend`, redeploy and test delivered verification and reset links. Existing testing accounts receive verification links on password sign-in; protected APIs reject their existing sessions until verification. See [TESTING_GUIDE.md](TESTING_GUIDE.md).

Use the trusted Vercel proxy for authentication's forwarded-IP rate limiting; self-hosted operators must configure trusted proxy headers correctly. Disable LiveKit Cloud automatic room creation. The application prepares rooms explicitly and revokes identities with a current cutoff before room deletion, including on cleanup retries. Cached-token reconnection is part of the required Cloud service tests, since JWT expiration alone does not close an active/refreshed session. [LiveKit participant revocation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/).

`/api/health` checks the database, LiveKit and mail configuration without exposing provider credentials, hostnames or database details (see "Monitoring and alerts" below). API failures include safe messages and request IDs. Error logs contain the request ID, error type, code and file:line frames, never request bodies, cookies or customer records. Unhandled route errors, billing webhook failures and browser errors also log a redacted first line of the message (`detail`: emails, tokens, credential pairs, configured secret values, URL queries and long numbers removed). Auth events log Better Auth's own message plus the type, code and frames of any error it passes, never that error's message. Provider errors such as mail delivery never log their message, because it can echo recipients or message contents. Production browser headers restrict camera/mic to this origin, prevent framing, and include a CSP. The CSP permits inline Next.js bootstrap scripts and WASM compilation; nonce-based CSP is a hardening follow-up, not a completed control.

## Monitoring and alerts

Four signals reach the operator without a third-party SDK.

| Signal | Source | Where it goes |
| --- | --- | --- |
| Server logs | `src/lib/logger.ts` (JSON lines, allow-listed fields, `LOG_LEVEL`) | Vercel runtime logs |
| Alerts | `error`-level events and the named critical events below | `ALERT_WEBHOOK_URL`, when set |
| Browser errors | `ClientErrorReporter` in the root layout, `error.tsx`, `global-error.tsx` | `POST /api/client-errors`, logged as `client_error` (warn) |
| Uptime | `.github/workflows/uptime.yml`, every 15 minutes | Failed GitHub Actions run |

**Alert webhook.** Set `ALERT_WEBHOOK_URL` (optional, Production scope only) to an incoming webhook that accepts a JSON POST with a `text` field: a Slack incoming webhook works as is, and a Discord webhook works with `/slack` appended. The production guard (`scripts/production-config.mjs`) rejects a non-https or local URL. Alerts are sent after the response (`after()` from `next/server`), with a 3-second timeout, so they never slow a request. Each alert names the event, route, status, error type/code and request ID. It never includes user, studio or target IDs, error text, paths or secrets. Repeats of the same event on the same route are muted for 5 minutes per server instance, and a request that already alerted does not alert again for its `request_complete` summary. A failed delivery is logged as `alert_delivery_failed` (warn) and never alerts. Alerting ignores `LOG_LEVEL`.

Every `error` event alerts (for example `api_error`, `request_unhandled`, `server_render_error`, `mail_delivery_failed`, `participant_revocation_failed`, `auth_event` at error level). These also alert, with a named label:

| Event or route | Alert label |
| --- | --- |
| `schema_readiness_failed` | Database unavailable or schema behind the deployed code |
| `health_dependency_down` | A required dependency failed the health check |
| `billing_webhook_failed` | Billing webhook processing failed |
| `orphaned_room_cleanup_failed` (warn) | Class room cleanup failed after a start or cancel |
| errors on `/api/retention` | Retention cron failed |
| errors on `/api/command` | Workspace command failed (class start, cancel or other control) |

A class start that fails arrives as an error on `/api/command`. The alert does not yet name the command action, because the dispatcher does not put it on the request context.

**Alert recipients.** The webhook's channel is the recipient list: create a dedicated channel (for example `#geez-squad-alerts`), add the on-call owner and a backup, and record both names in the incident log. Test it by temporarily setting `ALERT_WEBHOOK_URL` on a Preview deployment and calling a route that fails, or send a test message to the webhook from the provider's console. Rotate the URL like a secret if it leaks.

**Browser errors.** The caller address comes from the platform-set `x-vercel-forwarded-for` or `x-real-ip`, else the last `x-forwarded-for` entry, and is stored only as a keyed hash. The client reporter listens for `error` and `unhandledrejection`, and the error pages report the caught error with its digest. It drops duplicates and opaque `Script error.` events, sends at most 5 reports per page load with `navigator.sendBeacon` (fetch with `keepalive` as fallback), and redacts the message and URL before sending. The route checks the Origin, accepts at most 8 KB, validates with zod, rate-limits reports a minute to 20 per signed-in user, 20 per caller address and 300 across all anonymous callers (the shared bucket is checked first, so rotating a forwarded address cannot exceed it), attaches the user ID only when a session exists, and logs the redacted message, error name, frames, path (no origin or query, ID-like segments masked) and digest. Browser errors are warn-level and never alert, so an anonymous caller cannot page the operator. Search the logs for `client_error`.

**Health check.** `GET /api/health` returns `{ status }` (`ok` or `unavailable`) with status `503` when a required dependency fails, which is all the uptime workflow needs. A caller that sends `Authorization: Bearer <HEALTH_CHECK_TOKEN>` also gets `checks: { database, livekit, mail }`; anonymous callers never learn which services are configured. `HEALTH_CHECK_TOKEN` is optional (Production scope, at least 32 characters, independent of the auth and cron secrets, validated by `scripts/production-config.mjs`). Without it nobody gets the detail, and the operator reads the cause from the `health_dependency_down` log line or alert. The token is checked with a constant-time comparison. The checks:

- `database`: one row-free statement naming every table and column in the Prisma data model (`src/lib/health.ts`). `tests/health-readiness.test.ts` checks that it covers every table and column in `prisma/postgres/migrations`, so there is no hand-kept list. A reachable database with unapplied migrations reports `down`.
- `livekit`: `disabled` when the three LiveKit keys are unset, otherwise an authenticated `listRooms` call for a name that never exists, with a 2-second timeout. The result is cached for 30 seconds per instance. `down` fails the check.
- `mail`: configuration only (no message is sent). `disabled` when delivery is off or in test mode, `misconfigured` (fails the check) when `smtp` or `resend` is selected without its credentials and `EMAIL_FROM`.

**Uptime workflow.** In GitHub → Settings → Secrets and variables → Actions → Variables, add `UPTIME_URL` with the production origin (for example `https://geez-squad.vercel.app`, no path). The workflow calls `/api/health` up to three times, 20 seconds apart, and fails when none returns `200` with `"status":"ok"`. Without the variable it logs a notice and passes. GitHub emails a failed scheduled run to the user who last changed the workflow's schedule, so that person must keep Actions failure notifications on (Settings → Notifications → Actions). GitHub disables scheduled workflows after 60 days without repository activity; re-enable it from the Actions tab. Run it manually with "Run workflow" to test.

## Recovery and incidents

1. Check provider status, database connectivity, error IDs, auth verification delivery, and LiveKit room availability.
2. Degrade to human coaching/local camera practice when analysis or media fails. Explain the unavailable measurement rather than display stale assurance.
3. Rotate compromised keys in their providers and redeploy. Revoke affected auth sessions and investigate access audit events.
4. Roll back an application release only to a schema-compatible version. Restore a database from a verified backup into a separate environment and check row counts/access isolation before switching traffic.
5. Follow the published incident/notification process for affected users and markets; qualified review is required for legal obligations.

## Data retention

The cleanup endpoint is cron-secret-protected. Latest metrics: 7 days. Class messages: 90 days. Expired invites, sessions, verification records, and rate records are deleted. Summaries/account/studio records are retained for the operator's declared policy. Audit records contain actor/target IDs and control action but no camera frame data.

| Table | Kept for | Why |
| --- | --- | --- |
| `WebhookEvent` | 30 days (`createdAt`) | Only deduplicates billing webhook deliveries; Stripe stops retrying after 3 days. |
| `AuditEvent` | 400 days (`createdAt`), override with `AUDIT_RETENTION_DAYS` | A bit over a year keeps an annual review traceable. Values that are not whole numbers or are below 90 are ignored. Older booking events also drop out of My bookings history and the data export; `account.deleted` and `studio.*` events follow the same window. No access decision reads audit events. |

Both tables are pruned oldest first in batches of 500 IDs, at most 20 batches per table and 20 seconds in total per run (`src/lib/retention-policy.ts`), outside the main cleanup transaction. The JSON response reports `webhookEvents` / `auditEvents` as `{ deleted, complete }`. `complete: false` means a backlog remains, and the next daily run continues it. Set `AUDIT_RETENTION_DAYS` higher if a legal or contractual retention duty applies; the operator decides that duty.

Data export returns only the requesting user's own records. Settings → Delete my account (`POST /api/account`, `src/lib/account-deletion.ts`) erases the account after password re-entry and a typed `DELETE` confirmation, rate-limited to five attempts a minute. The user row cascades sign-in, sessions, workouts, check-ins, nutrition, enrollments and messages. Studio-owned member, term, payment, attendance and booking records are retained and unlinked (`userId` set to null). A deleted coach's primary-coach assignments are written to `CoachAssignmentHistory`, hosted upcoming classes fall back to the studio owner, live rooms are revoked, and an `account.deleted` audit event (IDs only) is kept. Owners of an open studio and users with an open subscription are refused with `STUDIO_OWNER` / `BILLING_ACTIVE`. An owner first transfers ownership or closes the studio (below); after that their deletion proceeds. Deleting the owner of a closed studio re-points the studio to a placeholder owner (`closed-studio-<studioId>`, `.invalid` address, no credential) inside the same transaction, so the studio's member, term, payment, attendance, class and workout records are retained instead of cascading. Do not delete financial records without an approved retention policy.

## Studio lifecycle

**Creation (operator approved).** A signed-in user with a verified email who has finished profile setup and has no studio sends a request from Settings → Run a studio (`POST /api/studio-requests`, action `submit`: studio name, contact phone, optional note; one pending request per user, five requests a minute). Platform operators are the accounts whose **verified** email is listed in the optional `PLATFORM_OPERATOR_EMAILS` variable (comma-separated, case-insensitive). Job titles, studio roles and the user `role` column never make someone an operator; an unverified address on the list does not count. Leave the variable unset and requests simply wait. Operators see Settings → Studio requests and approve or decline. Approval creates the studio with the requester as owner and first `admin` grant, marks the request approved and writes a `studio.created` audit event (IDs only) in one serializable transaction. The status change is conditional on `pending`, so a double-click or concurrent approval creates one studio and the repeat returns the same studio id. Approval is refused if the requester has since joined or been given another studio. Declines are audited as `studio.requestRejected`; requesters can withdraw a pending request.

**Ownership transfer.** Settings → Studio ownership (`POST /api/studio-ownership`, action `transfer`) lets the owner hand the studio to anyone with current access to it (active admin or coach grant, or an accepted trainee whose grant is not revoked) who owns no other studio and, when verification is enforced, has a verified email. It needs password re-entry and a typed `TRANSFER` (five attempts a minute). In one transaction: classes that were falling back to the owner as host are pinned to the former owner, `Studio.ownerId` moves, both people hold an active `admin` grant (the former owner stays admin until the new owner removes them in Team), and `studio.ownershipTransferred` is audited with both IDs. Subscriptions are per user and do not move; see billing below.

**Closure.** Action `close` (password plus typed `CLOSE`) is available to the owner only. One transaction marks the studio `closed` (`Studio.status`, `closedAt`, `closedById`), revokes every role grant, deletes trainee connections and plan assignments (so former trainees can join another studio), moves primary-coach assignments to `CoachAssignmentHistory`, deletes unused invitations, withdraws pending team and join requests, cancels scheduled live classes and studio classes with their bookings, and audits `studio.closed`. Live classes then end through `completeLiveClass` (the same path as End and auto-completion), which deletes their video rooms; a failure there is logged (`studio_close_class_end_failed`) and the retention job's abandoned-class sweep completes the class. Repeating `close` only retries ending live classes. A closed studio grants nobody access: `studioAccess` ignores closed studios, so every studio, assignment, nutrition-sharing and class-management check fails closed. The member register, terms, payments, attendance, class history and trainees' own workout records are retained under the existing retention rules. Nutrition stays with its owner and was never studio data. Reopening a closed studio is not supported in the application. Cancel any studio subscription in the billing portal separately; an open subscription still blocks that user's account deletion.

## Known engineering limits

- Metrics, cues, and control state use 3-second polling rather than a durable realtime bus. Hidden tabs poll every 15 s and refresh immediately when shown; unchanged trainee summaries are re-sent as a 9 s heartbeat (coach freshness window 12 s). The class poll runs its independent reads concurrently. Local detector feedback is immediate. The enrollment ceiling is 100; it is not a verified concurrency guarantee. Load-test the intended PostgreSQL and RTC concurrency before increasing operational class sizes.
- Clients compute their own estimates; the backend validates bounds but cannot attest that they came from an actual camera. They must not be used for competitions, insurance, medical decisions, or fraud-sensitive rewards.
- Scores are heuristic geometry comparisons. The included rule version is `profile-v10`; no validated learned scoring model exists yet. Bridge, crunch, and row have no numeric form score. Keep one trainee in view: the configured single-person tracker cannot reliably reject all extra people.
- Stopping local analysis while a shared camera is active stops inference, not the separately indicated video room stream. Use the room camera toggle or leave video to stop sharing.
- Browser CPU performance, thermal throttling, supported Safari behavior, and live WebRTC reconnection remain to be measured on physical devices.
- Stripe and email integration code needs real service tests; Stripe has not been exercised end to end. When billing is enabled (all three Stripe keys set), starting a live class requires the studio owner or an active studio admin to hold an `active` or `trialing` subscription (`src/lib/billing-entitlement.ts`, HTTP 402 `SUBSCRIPTION_REQUIRED`); `past_due`, `unpaid` and `incomplete` are not entitled, and a class already live is never interrupted. The plan defines one price and no seat limit, so no seat cap is enforced. With billing disabled (default) nothing changes. Push notifications and coach verification are future milestones; operator-approved studio creation, ownership transfer and closure shipped on 12 November 2026. Self-service account deletion and weekly recurring studio classes shipped on 9 November 2026.
- Critical membership/enrollment and metrics operations use serializable transactions. The shared write helper provides bounded serialization-conflict retries and serializes local SQLite writes. Observe retries and failures under PostgreSQL load; local SQLite checks do not establish production concurrency behavior.
- Workspace history is bounded to 100 classes per status, 500 saved sets, and 100 check-ins. Live classes and nearest scheduled classes are selected independently of history. Insights reveals loaded exercise records in batches of 50 and can retry pending device saves. Direct authorized room access is independent of class-list bounds. Backend pagination is still required for complete lifetime history.

See the [12 October codebase audit](archive/CODEBASE_AUDIT_2026-10-12.md) for the latest fixes, evidence, and unresolved acceptance work.

Before production, assess dependency licensing, conduct threat modeling/pentesting, test all service failure states, name the alert recipients (see "Monitoring and alerts"), and rehearse restores (see below). The included checks are development verification, not an independent security certification.

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
