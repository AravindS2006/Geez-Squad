# Production readiness gaps

Audit date: 10 November 2026, at commit `a36f8a8` on `master`. Read-only: no code was
changed and no test suite was run for this audit.

Method: read `docs/AI_HANDOFF.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, then the
source. Every row cites a file and line, or a step that reproduces it.

Limits of this audit:

- The live Vercel, Neon and LiveKit configuration was not inspected. Rows that depend on
  it cite what the docs say is configured and are marked "per docs".
- LiveKit behaviour (duplicate identity, reconnect) is reasoned from the client code and
  LiveKit's documented behaviour, not observed on real devices.
- Authorization was spot-checked on the live-class paths (token, poll, metrics, command),
  not re-audited route by route. No authorization hole was found in those paths.

Ordered by severity, then effort (S under a day, M a few days, L a week or more or needs
people and devices).

## Status since the audit

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Fixed in code, 10 November 2026. The production build guard rejects `EMAIL_DELIVERY=test`, and the docs now say production uses `smtp`. **Open until the owner** sets `EMAIL_DELIVERY=smtp` and `EMAIL_FROM` in Vercel, redeploys, and confirms that verification and reset emails arrive. | `scripts/production-config.mjs`; `tests/production-config.test.ts`; `docs/DEPLOYMENT.md` section 3 |
| 2 | Partly fixed, 10 November 2026. A backup and restore rehearsal script, runbook and rehearsal log now exist, and the script was proven on disposable local PostgreSQL. **Open until** the rehearsal has run on Neon, the result is logged, and the Neon plan decision is recorded. | `scripts/rehearse-restore.mjs`; `scripts/test-restore-rehearsal.mjs`; `docs/OPERATIONS.md` "Backup and restore" |
| 3 | Fixed after the audit commit by `22c5207` (#11). Camera analysis and the connected live room hold a shared screen wake lock, which is reacquired when the tab is shown again. Not yet measured on physical phones. | `src/lib/screen-wake-lock.ts`; `src/components/camera-analyzer.tsx:270`; `src/components/studio.tsx:140`; `tests/screen-wake-lock.test.ts`; `tests/e2e/wake-lock.spec.ts` |
| 4 | Fixed in code, 13 November 2026. The disconnect reason is read and shown with a Rejoin button; transient network drops rejoin automatically with bounded backoff (a flapping link stops after 3 attempts), never for duplicate identity, removal or class end. Not measured on physical phones. | `src/lib/room-disconnect.ts`; `src/components/studio.tsx`; `tests/room-disconnect.test.ts` |
| 5 | Fixed in code. Browser `error`/`unhandledrejection` and the error pages report to `POST /api/client-errors` (redacted, deduplicated, rate limited). | `src/components/client-error-reporter.tsx`; `src/app/api/client-errors/route.ts`; `tests/client-errors.test.ts` |
| 6 | Fixed in code. **Open until the owner** sets `ALERT_WEBHOOK_URL`, the `UPTIME_URL` repository variable and names the alert recipient. | `src/lib/logger.ts`; `.github/workflows/uptime.yml`; `docs/OPERATIONS.md` "Monitoring and alerts" |
| 7 | Page and signup links added. **Open until the owner** fills the four marked placeholders and the text has legal review. | `src/app/terms/page.tsx`; `src/components/auth-form.tsx` |
| 8 | Fixed in code. Abandoned live classes complete from the poll (coach absent 10 min, or past duration + 60 min, cap 3 h) and from the daily retention sweep; one shared completion path with End. | `src/lib/class-completion.ts`; `src/lib/class-lifecycle.ts`; `tests/class-completion.test.ts` |
| 9 | Fixed in code. Trainee poll 21 → 9 SQL statements, coach 17 → 8; 60 s session cookie cache, with fresh sessions on sensitive routes. | `tests/class-poll-queries.test.ts`; `tests/fresh-session-routes.test.ts` |
| 10 | Fixed in code. Operator-approved studio requests (`PLATFORM_OPERATOR_EMAILS`). **Open until the owner** sets the operator list. | `src/lib/studio-lifecycle.ts`; `src/app/api/studio-requests/route.ts` |
| 11 | Fixed in YAML, not yet run in Actions: the `postgres-api` job runs six API suites against PostgreSQL on Linux. | `.github/workflows/ci.yml`; `scripts/ci-postgres-api.mjs` |
| 12 | Partly fixed: a manual media-capacity workflow against a LiveKit dev server (a software regression check, not capacity proof). **Open:** the real 36-trainee soak test and LiveKit plan limits need people and devices. | `.github/workflows/media-capacity.yml` |
| 13 | **Open.** Physical validation with consenting participants and the device matrix cannot be done in code. | — |
| 14 | Fixed in code. `media_join_failed` is sent; health events carry studio/class ids only when the caller is authorized for that class. | `src/lib/coaching-health-scope.ts`; `tests/coaching-health.test.ts` |
| 15 | Fixed in code. The coach's in-class cues use per-class buckets (180/min cues, 240/min controls); trainees keep 60/20. | `src/lib/class-lifecycle.ts` `COMMAND_LIMITS` |
| 16 | Partly fixed. Summaries follow server-recorded consent and continue over HTTP while video is down. **Open:** a studio with no video service has no consent path, so nothing is shared. | `src/lib/summary-sharing.ts` |
| 17 | Fixed in code. Queued saves retry on `online`, on visibility return and on load, deduplicated by clientId. | `src/lib/workout-save.ts`; `tests/workout-save.test.ts` |
| 18 | Fixed in code. The live room uses `liveRoomData` (staff 25 → 14 reads, trainees 21 → 14). | `src/lib/workspace.ts` |
| 19 | Fixed in code. Expected schema is derived from the Prisma model; LiveKit and mail checks; detail only with `HEALTH_CHECK_TOKEN`. | `src/lib/health.ts`; `tests/health-readiness.test.ts` |
| 20 | Fixed in code. Auth logger, unhandled route errors and billing webhook failures now log redacted causes. | `src/lib/auth.ts`; `src/lib/request-log.ts`; `src/app/api/billing/webhook/route.ts` |
| 21 | Fixed. The hard-coded migration list is replaced with how to read the real state. | `docs/DEPLOYMENT.md` |
| 22 | Fixed in YAML and docs. **Open until** a repository admin creates the `production`/`staging` GitHub Environments, secrets and the Neon staging branch. | `.github/workflows/release-migrate.yml`; `docs/DEPLOYMENT.md` |
| 23 | Fixed in code. Ownership transfer and studio closure; the former owner can then delete their account. | `src/app/api/studio-ownership/route.ts`; `scripts/test-account-lifecycle.mjs` |
| 24 | Fixed in code. Per-request nonce CSP via `src/proxy.ts`; every page is now rendered per request. | `src/lib/content-security-policy.ts`; `tests/video-policy.test.ts` |
| 25 | Partly fixed. The gate scans 41 signed-in views, including both live rooms with a fake camera. **Open:** the independent human review. | `scripts/check-accessibility.mjs`; `scripts/a11y-signed-in-fixture.mjs` |
| 26, 27 | Fixed in code. The gallery tile describes reps, hold, tracking and connection via `aria-describedby`; the cue banner pauses on hover/focus and has a Keep toggle. | `src/lib/live-room-a11y.ts`; `src/components/coach-monitor.tsx` |
| 28, 29, 30 | Fixed. Redacted failure artifacts, Dependabot, production audit at moderate, lint cap 77 → 72. | `scripts/redact-playwright-results.mjs`; `.github/dependabot.yml`; `package.json` |
| 31, 32 | Fixed in code. Webhook events pruned after 30 days, audit events after 400 (`AUDIT_RETENTION_DAYS`), in bounded batches; class and audit indexes added. | `src/lib/retention-policy.ts`; `prisma/migrations/20261113090000_db_housekeeping_indexes/` |
| 33, 34 | Fixed in code. Checksummed, cached, mirror-able model downloads; pose assets at a versioned path with immutable caching and a versioned service-worker cache. | `scripts/pose-assets.mjs`; `public/sw.js`; `tests/pose-assets.test.ts` |
| 35 | Fixed in code. End commits first, then revokes tokens 8 at a time and deletes the room once; teardown failure never reports the class as not ended. | `src/lib/class-completion.ts` |
| 36, 37 | Fixed in code. The LiveKit sweep runs after the response with a cross-instance claim row; rate limiting skips writes for steady-cadence summaries, per user. | `src/lib/member-access.ts`; `src/lib/rate-window.ts` |
| 38 | Partly fixed. With billing on, starting a live class requires an active or trialing subscription. **Open:** real Stripe end-to-end testing. | `src/lib/billing-entitlement.ts` |
| 39 | **Open, accepted.** Client-reported reps cannot be proven to come from a camera; acceptable for coaching, not rewards. | — |

| # | Area | Gap | User impact | Severity | Effort | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Deploy/env | Production is documented as running `EMAIL_DELIVERY=test`, and the production guard accepts that mode. It turns off email verification and password reset. | Anyone can register with another person's email address. A forgotten password locks the account for good, because there is no recovery path. | blocker | S | `docs/DEPLOYMENT.md:52` (per docs); `src/lib/email-policy.mjs:9-17`; `scripts/production-config.mjs:26-40` |
| 2 | Data/migrations | Backup and restore have never been rehearsed, and the database is on Neon's Free plan, which the docs call an initial choice with no SLA. | A bad migration or accidental delete could lose member, payment and workout records with no proven way back. | blocker | M | `docs/DEPLOYMENT.md:17`; `docs/DEPLOYMENT.md:109`; `docs/OPERATIONS.md:38` |
| 3 | Trainee room | No screen wake lock anywhere, and a hidden tab invalidates tracking. | A phone on the floor dims and locks mid-set. Counting stops and the trainee must walk back, unlock and restart. | high | S | `src/components/camera-analyzer.tsx:804-809`; `rg -i wakelock src public` returns nothing |
| 4 | Live video | The `Disconnected` handler clears the room state without reading the reason, showing a message or rejoining. | After a network drop that LiveKit cannot recover, or when the same account joins in a second tab, the video just vanishes and the person has to work out that they must press Join again. | high | S | `src/components/studio.tsx:610-622`. Repro: join a live class, open the same `/studio/[id]` in a second tab and join; the first tab returns to "Not connected" with no explanation |
| 5 | Monitoring | Browser errors are never reported. The error pages only render, there is no `window` error or rejection listener, and server instrumentation covers server renders only. | A crash in the live room or camera analyzer on a trainee's phone is invisible to the operator until someone complains. | high | S | `src/app/error.tsx:2-23`; `src/app/global-error.tsx:3`; `src/instrumentation.ts:3`; `rg "addEventListener\('(error\|unhandledrejection)'" src` returns nothing |
| 6 | Monitoring | Logs go to `console` only. There is no error tracker, alert rule, uptime check or named alert recipient. | A failed class start, a failing retention cron or a database outage is noticed only if someone reads Vercel logs. | high | S | `src/lib/logger.ts:36-39`; `docs/DEPLOYMENT.md:109`; `docs/OPERATIONS.md:38` |
| 7 | Deploy/env | No terms of service page. Only `/privacy` exists, and the docs list published terms, contacts and retention policy as a launch gate. | Studios and trainees sign up with no terms covering camera use, coaching or liability. | high | S | `src/app/` has `privacy/` and no terms route; `docs/DEPLOYMENT.md:109` |
| 8 | Coach room | A live class ends only when the coach presses End. Nothing completes a class the coach abandoned, and the retention job does not touch classes. | If the coach's browser crashes or they close the tab, the class shows as live indefinitely, trainees stay in a room with no coach, and the LiveKit room is held for up to three hours. | high | M | `src/app/api/command/route.ts:669-670` (only path to `completed`); `src/app/api/command/route.ts:793-794`; `src/app/api/retention/route.ts:17-24` |
| 9 | Backend/API performance | Each participant polls the class every 3 s, and one trainee poll costs about 13 database queries: session lookup and a second user read, class, studio access, admin grants, three snapshot reads and four membership reads. Session cookie caching is off. | A 36-trainee class produces roughly 150 queries a second against a Free-plan database. Coach metrics and cues lag or polls fail under load. | high | M | `src/components/studio.tsx:297-354`; `src/app/api/classes/[id]/route.ts:13-70`; `src/lib/security.ts:21-23`; `src/lib/studio-access.ts:11-33`; `src/lib/studio-access.ts:113-119`; `src/lib/member-access.ts:20-42`; `src/lib/auth.ts:60` |
| 10 | Auth and studio permissions | No application path creates a studio or its first admin. Onboarding only accepts the trainee role; the only `studio` create is in a local fixture script. | A new studio cannot sign itself up. An operator has to write to the production database by hand, which the working agreements otherwise forbid. | high | M | `src/lib/validation.ts:31-32`; `src/app/api/command/route.ts:124-137`; `scripts/local-studio-fixture.mjs:10-11`; `docs/OPERATIONS.md:32` |
| 11 | CI | API, role and browser suites run only on Windows against SQLite. The PostgreSQL job runs a migration rehearsal, not the API suite. Production is Linux and PostgreSQL. | Serializable-transaction conflicts and provider differences in the class and metrics paths first show up with real users. | high | M | `.github/workflows/ci.yml:31`; `.github/workflows/ci.yml:41`; `.github/workflows/ci.yml:84-94`; `docs/OPERATIONS.md:33` |
| 12 | Live video | The target of one coach with 36 trainees has never been soak-tested, the LiveKit plan limits are unconfirmed, and the media capacity script is not part of CI. | The first full class is the load test. Likely failures are trainees unable to join or the coach gallery freezing. | high | L | `docs/AI_HANDOFF.md:17-19`; `docs/AI_HANDOFF.md:260-262`; `docs/DEPLOYMENT.md:38`; `docs/DEPLOYMENT.md:42`; `package.json:25` |
| 13 | Pose/counting | The 12 automatic profiles have no physical validation with consenting participants, scores are heuristic, and iPhone Safari and thermal behaviour are unmeasured on real devices. | Rep counts and form scores can be wrong for real bodies, lighting and phones, and coaches see those numbers as if they were measured. | high | L | `docs/AI_HANDOFF.md:114-118`; `docs/AI_HANDOFF.md:260-262`; `docs/OPERATIONS.md:29`; `docs/OPERATIONS.md:31` |
| 14 | Monitoring | Client health events are logged with no studio, class or user, and `media_join_failed` is declared but never sent from the join failure path. | Operators can see that tracking or saving failed somewhere, but not for whom, and failed video joins are not counted at all. | medium | S | `src/app/api/coaching-health/route.ts:25`; `src/lib/coaching-health.ts:6`; `src/components/studio.tsx:650-659` |
| 15 | Coach room | A coach shares one 60-per-minute limit across every command and is capped at 20 messages or cues a minute. | A coach cueing a 36-trainee class individually gets "Please wait a minute" partway through. | medium | S | `src/app/api/command/route.ts:51`; `src/app/api/command/route.ts:751` |
| 16 | Trainee room | Trainee summaries are sent only while the video room is connected. | If video drops or is unavailable, the coach also loses that trainee's reps and form, even though local counting still works. | medium | S | `src/components/studio.tsx:383-392` |
| 17 | Trainee room | Saves queued while offline are retried only when the trainee presses Retry. Nothing retries when the connection returns. | A set recorded during a network blip stays unsaved on that device until the trainee notices the banner. | medium | S | `src/lib/workout-save.ts:43-56`; `src/components/camera-analyzer.tsx:617`; `src/components/camera-analyzer.tsx:793-796`; the only `online` listener is `src/components/app-install.tsx:44` |
| 18 | Backend/API performance | The live room page loads the full workspace payload for a single class, including up to 500 saved sets and 100 check-ins it does not use. | Slower entry to the live room, worst on phones and for coaches with many trainees. | medium | S | `src/app/studio/[id]/page.tsx:19`; `src/lib/workspace.ts:109-120` |
| 19 | Monitoring | `/api/health` checks the database schema only, and its column list stops before the nutrition, custom exercise, correction and workout snapshot migrations. It does not check LiveKit or mail. | Health reports "ok" while live video or email is broken. | medium | S | `src/app/api/health/route.ts:10-21` |
| 20 | Error handling | Three failure paths log nothing useful: the auth logger drops the message, an unhandled route error is logged without the error, and a failed billing webhook is not logged. | Sign-in failures and unexpected 500s cannot be diagnosed from logs. | medium | S | `src/lib/auth.ts:12-15`; `src/lib/request-log.ts:31-33`; `src/app/api/billing/webhook/route.ts:84-88` |
| 21 | Deploy/env | `DEPLOYMENT.md` lists five migrations as applied to production while the repository has eleven, and its environment table omits the `smtp` mode it recommends elsewhere. | An operator cannot tell from the docs what state production is in before a release. | medium | S | `docs/DEPLOYMENT.md:19`; `docs/DEPLOYMENT.md:46`; `docs/DEPLOYMENT.md:69`; `prisma/postgres/migrations/` (11 directories) |
| 22 | Deploy/env | Migrations are applied by hand from a workstation after pulling production variables to disk, and there is no working staging environment (previews may fail their prerequisites). | Every release depends on one person running the right commands in the right order, with production credentials on a laptop. | medium | M | `docs/DEPLOYMENT.md:21-28`; `docs/DEPLOYMENT.md:81`; `docs/AI_HANDOFF.md:238-239` |
| 23 | Auth and studio permissions | Studio owners are refused account deletion, and there is no studio closure or ownership transfer. | An owner who wants to leave or erase their data has no self-service route. | medium | M | `docs/OPERATIONS.md:23`; `docs/OPERATIONS.md:32` |
| 24 | Auth and studio permissions | The content security policy allows inline scripts. | Any injected markup can run script in a signed-in session; the policy does not act as a second line of defence. | medium | M | `next.config.ts:34-40`; `docs/OPERATIONS.md:9` |
| 25 | Accessibility | The automated accessibility gate scans only public and `/demo` routes, and the independent review listed as a launch gate has not happened. | Problems in the signed-in trainee and coach rooms with real video can ship unnoticed. | medium | M | `scripts/check-accessibility.mjs:29-49`; `docs/DEPLOYMENT.md:109` |
| 26 | Accessibility | Each coach gallery tile is a button whose `aria-label` replaces its contents, so reps, hold time and connection quality are not announced. | A coach using a screen reader hears only "Focus name". | low | S | `src/components/coach-monitor.tsx:200-206` |
| 27 | Accessibility | The coach cue banner hides after 20 s with no way to extend it (it stays in chat). | A trainee who reads slowly or is mid-rep can miss the cue. | low | S | `src/components/studio.tsx:93`; `src/components/studio.tsx:826-831` |
| 28 | CI | A failed browser run keeps no trace or screenshot. This is deliberate to avoid leaking cookies. | Flaky or CI-only failures have to be reproduced locally before they can be fixed. | low | S | `.github/workflows/ci.yml:82-83` |
| 29 | CI | No automated dependency updates, and the audit step fails only on high severity. | Security fixes in Next.js, Better Auth or LiveKit arrive only when someone remembers to check. | low | S | `.github/workflows/ci.yml:46`; no `.github/dependabot.yml` |
| 30 | CI | Lint passes with up to 77 warnings. | Real warnings hide in the baseline. | low | S | `package.json:17` |
| 31 | Data/migrations | `AuditEvent` and `WebhookEvent` are never pruned, and `AuditEvent` has no index on `targetId`. | Slow growth, and audit lookups by target scan the table. | low | S | `src/app/api/retention/route.ts:17-24`; `prisma/schema.prisma:490-502` |
| 32 | Data/migrations | `ClassSession` is indexed only on studio and start time, while workspace queries filter by status and host. | Class lists slow down as a studio's history grows. | low | S | `prisma/schema.prisma:339`; `src/lib/workspace.ts:80-91` |
| 33 | Deploy/env | A clean build downloads the three pose models from Google storage. | A storage outage blocks every deploy, including an urgent fix. | low | S | `scripts/prepare-assets.mjs:33` |
| 34 | Pose/counting | Model and WASM files get no long-lived cache header and the service worker does not cache them. | The pose model is revalidated on every start, which is slow on a weak mobile connection. | low | S | `public/sw.js:4`; `next.config.ts:16-23` |
| 35 | Live video | Ending a class sends one LiveKit removal per enrolled identity, up to 100, inside the request. | Ending a large class is slow and can return a retry error even though the class did end. | low | S | `src/app/api/command/route.ts:824-849` |
| 36 | Live video | The participant-revocation throttle is an in-memory map per server instance, and the coach's poll waits for the LiveKit sweep. | More LiveKit API calls than intended on serverless, and a slow coach poll every 30 s. | low | M | `src/lib/member-access.ts:116-138`; `src/app/api/classes/[id]/route.ts:63-70` |
| 37 | Backend/API performance | Every rate-limited call writes a `RateLimit` row, including each metrics heartbeat. | Extra write load on the same database during a live class. | low | M | `src/lib/security.ts:64-73`; `src/app/api/metrics/route.ts:137` |
| 38 | Deploy/env | Stripe code is untested against the real service and paid entitlements are not enforced. Billing is off by default. | No impact until billing is enabled; then a studio could use classes without paying. | low | M | `docs/DEPLOYMENT.md:73`; `docs/OPERATIONS.md:32` |
| 39 | Auth and studio permissions | The server bounds client-reported reps but cannot prove they came from a camera. | A trainee can send plausible fake counts. Acceptable for coaching, not for rewards or competitions. | low | L | `src/app/api/metrics/route.ts:77-89`; `docs/OPERATIONS.md:28` |

## Suggested order of PRs

1. Switch production to verified email (`smtp` or `resend`), test verification and reset, and update `DEPLOYMENT.md` to the real state (gaps 1, 21).
2. Rehearse a Neon restore into a separate database and record the steps and plan decision (gap 2).
3. Add an error tracker with alerts, a browser error reporter and an uptime check on `/api/health` (gaps 5, 6).
4. Request a screen wake lock while the camera or live room is active (gap 3).
5. Show the disconnect reason and offer one-tap or automatic rejoin (gap 4).
6. Publish terms of service and link them from signup (gap 7).
7. Auto-complete abandoned live classes from the retention job or a class heartbeat (gap 8).
8. Cut the class poll's query count and enable session cookie caching (gaps 9, 18).
9. Run the API suites against PostgreSQL on Linux in CI (gap 11).
10. Add an operator-approved studio creation flow (gap 10).
11. Add identifiers to health events, send `media_join_failed`, and fix the three silent log paths (gaps 14, 20).
12. Raise or split the coach's in-class rate limits (gap 15).
13. Keep sending summaries without video, and retry pending saves when back online (gaps 16, 17).
14. Extend `/api/health` to the latest schema and LiveKit reachability (gap 19).
15. Run a distributed 36-trainee soak test on the chosen LiveKit plan (gap 12).
16. Run the physical exercise validation and device matrix, including iPhone Safari (gap 13).
17. Automate migrations in a release workflow and stand up a staging environment (gap 22).
18. Add studio closure and ownership transfer (gap 23).
19. Move to a nonce-based content security policy (gap 24).
20. Scan signed-in rooms in the accessibility gate, fix the tile label and cue timeout, and commission the review (gaps 25, 26, 27).
21. CI housekeeping: redacted failure artifacts, dependency updates, lower the lint baseline (gaps 28, 29, 30).
22. Database housekeeping: prune audit and webhook events, add the class and audit indexes (gaps 31, 32).
23. Asset delivery: cache the pose models at build and in the browser (gaps 33, 34).
24. Live-class efficiency: batch room teardown, shared revocation throttle, cheaper rate limiting (gaps 35, 36, 37).
25. Before enabling billing: test Stripe end to end and enforce entitlements (gap 38).
