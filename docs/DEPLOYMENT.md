# Deploy Geez Squad on Vercel and LiveKit Cloud

The workspace is linked to `aravinds2006s-projects/geez-squad`, project `prj_m5uOzEvrg5TZ44AKN2CJ2jRJlERK`. The app domain is `geez-squad.vercel.app`. The connected GitHub repository is `AravindS2006/Geez-Squad`; its current public visibility was preserved during the rename. Pushes trigger remote builds. `EMAIL_DELIVERY=test` enables operator signup while deferring email. See the [release plan](GEEZ_SQUAD_RELEASE.md) and [verification report](VERIFICATION.md). Configure secrets directly in the providers rather than sending them in chat.

The private auth and cleanup secrets, exact app origin, PostgreSQL provider, and LiveKit keys have been configured for Production. Node 22.x, the guarded build command, and staged domain assignment are configured. Release checks are documented in VERIFICATION.md. See `.env.production.example` for the production template.

## 1. PostgreSQL

The approved database setup is a dedicated `geez-squad-production` Neon resource, Free plan `free_v3`, Singapore `sin1`, connected only to Production, with Neon Auth disabled because Geez Squad uses Better Auth. Vercel functions are aligned to `sin1`. The owner has accepted Neon's Marketplace terms, and the resource is created and connected. Its offered plan/regions were checked through Vercel CLI 62.4.0 on 6 October 2026.

Equivalent setup syntax is shown below. The existing resource was renamed to `geez-squad-production` without provisioning another database; reuse it:

```sh
npx vercel@62.4.0 integration add neon --name geez-squad-production --plan free_v3 --metadata region=sin1 --metadata auth=false --environment production --no-env-pull --scope aravinds2006s-projects
```

Do not retry creation if a previous attempt completed; inspect the integration/resource first. Use a pooled runtime URL and a direct migration URL. Neon injects `DATABASE_URL_UNPOOLED`; set `DIRECT_URL` to that same direct connection in Production. Keep preview, test, and production data separate. The Free plan is an initial setup choice, not a throughput/SLA guarantee; evaluate backups, limits, and load before broad launch. [Neon Marketplace integration](https://vercel.com/integrations/neon).

The canonical model is `prisma/schema.prisma`. `scripts/postgres.mjs` creates an equivalent ignored PostgreSQL schema; committed PostgreSQL migrations are in `prisma/postgres/migrations`. The live Neon database has `20261006000000_init`, `20261009000000_training_insights`, `20261009140000_session_room_identity`, `20261019000000_studio_operations`, and `20261019010000_studio_classes`. The studio migrations were applied on 19 October after an isolated rehearsal and verification that existing accounts were preserved. See [the login deployment repair](LOGIN_DEPLOYMENT_FIX.md). Apply migrations before deploying the matching build. Broader concurrency, load, and restore trials remain separate acceptance work.

Run migrations from a secure release environment with the production values loaded:

```sh
npx vercel@62.4.0 env pull .vercel/.env.production.local --environment=production --yes --scope aravinds2006s-projects
node --env-file=.vercel/.env.production.local scripts/postgres.mjs migrate
node --env-file=.vercel/.env.production.local scripts/postgres.mjs check
node --env-file=.vercel/.env.production.local scripts/verify-postgres.mjs
```

Vercel's write-only Secret variables are pulled as `[SENSITIVE]` placeholders. The production guard rejects those placeholders; it runs with actual secrets in Vercel's remote build, or in an authorized release environment where the actual values have been securely injected. Do not copy placeholder values back into Vercel. Database-only migration/read commands require the actual pooled/direct PostgreSQL values; they do not need video or mail credentials. [Vercel Secret variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

Changing the provider does not move existing SQLite data. Local preview records are disposable; production starts in its own PostgreSQL database. For future schema edits, generate separate migrations for both providers and test them on their respective databases. Never regenerate the initial migration after deployment.

## 2. LiveKit Cloud

Create a LiveKit project. Add `LIVEKIT_URL` (`wss://...livekit.cloud`), `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` as server environment variables. Do not use NEXT_PUBLIC prefixes. API keys stay on the server; the browser receives a short-lived, room-scoped access token after its identity, enrollment, consent, and class status are checked.

The owner has completed LiveKit signup. Sign in at [LiveKit Cloud](https://cloud.livekit.io) and create or select the Geez Squad project. Confirm the selected plan and its limits before using it for public classes. Open Project Settings for the Project URL, then the project's API Keys section to create a dedicated Geez Squad server key. Enter the URL, API key, and API secret in [Geez Squad's Vercel environment settings](https://vercel.com/aravinds2006s-projects/geez-squad/settings/environment-variables), targeted to Production. Mark the API secret as Sensitive. Never send key values in chat. Geez Squad handles token generation and room creation; no LiveKit Agent deployment is required. [LiveKit connection settings](https://docs.livekit.io/intro/basics/connect/).

Disable automatic room creation in the LiveKit Cloud project. Geez Squad explicitly creates a capacity-bounded room when the coach starts the class. On completion it revokes enrolled identities with an explicit cutoff and deletes the room. Disabling auto-creation prevents cached room tokens from recreating a completed class. Verify these Cloud-specific settings and revocation behavior with real connections before launch. [LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/).

Test coach and trainee accounts on two physical devices over separate networks. Verify camera/mic toggles, device denial, reconnect, browser audio autoplay, mobile CPU/thermal behavior, and room closure. Scheduling supports up to 100 enrolled trainees plus one coach, including an option to resolve the entire current studio roster on the server. Large galleries scroll on small displays. Enrollment capacity is not validated peak RTC capacity: check LiveKit limits and run concurrent-device load tests for the intended class size. Group visibility is explicit in the join preflight; private one-to-coach-only video is not provided in this build.

## 3. Identity and email

The current no-domain option is free Gmail SMTP with the existing mailbox. See [account upgrade deployment instructions](ACCOUNT_MEMBERSHIP_UPGRADE.md#free-gmail-sending). Configure `EMAIL_DELIVERY=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and matching `EMAIL_FROM`; test verification and recovery before release. The Resend/domain instructions below describe the retained alternative transport.

Set a unique random `BETTER_AUTH_SECRET` of at least 32 characters and the exact HTTPS `BETTER_AUTH_URL`. Production verification is required unless the operator explicitly selects testing mode. Configure Resend using a verified sending domain and `RESEND_API_KEY`/`EMAIL_FROM`; test verification and password-reset delivery. Invite links are generated for manual sharing and require both their secret link and the matching invited email address.

The two generated secrets are independent and stored as sensitive Production variables. The app origin is `https://geez-squad.vercel.app` unless a custom domain is explicitly configured later.

The owner has completed Resend signup and has requested two-role testing before purchasing a domain. Set `EMAIL_DELIVERY=test` in Production and redeploy. Builds do not require `EMAIL_FROM` or `RESEND_API_KEY`. Dormant mail credentials are ignored and no mail callbacks are installed. Signup and sign-in work with unverified accounts; passwords must be saved because email recovery is unavailable. The login page visibly labels testing mode. Account records remain unverified, and invitation secrecy, membership checks, password rules, and rate limits remain enforced. Use this mode for operator testing, not verified client identity. See [TESTING_GUIDE.md](TESTING_GUIDE.md).

Use `EMAIL_DELIVERY=disabled` if signup must be closed instead. It preserves verified-account sign-in and rejects unverified accounts even if they have an existing testing session. Both modes defer email; only `test` permits unverified signup and login. Do not use dummy sender values.

When the domain is available, add it to Resend (a sending subdomain is suitable), publish the exact DNS records Resend provides, and wait for verified status. Create a domain-scoped sending key and add `RESEND_API_KEY` plus a sender such as `Geez Squad <hello@your-verified-domain>` in Vercel Production. Set `EMAIL_DELIVERY=resend` and redeploy to enable verification email and password reset. Existing testing accounts must verify: password sign-in sends a verification link, and their unverified sessions lose access to protected APIs. Test actual delivery before opening client onboarding. Unspecified production delivery mode defaults to `resend`, so missing mail credentials still fail the build unless deferral is explicit. A Vercel subdomain does not give ownership of `vercel.app` DNS. Resend's test sender has recipient restrictions and is not a public onboarding solution. [Resend domain documentation](https://resend.com/docs/dashboard/domains/introduction).

## 4. Required production environment

| Key | Purpose |
| --- | --- |
| `DATABASE_PROVIDER=postgresql` | Select production auth/database adapter |
| `DATABASE_URL` | Pooled PostgreSQL runtime URL |
| `DIRECT_URL` | Direct PostgreSQL migration URL |
| `BETTER_AUTH_SECRET` | Authentication signing secret |
| `BETTER_AUTH_URL` | Exact HTTPS app origin |
| `LIVEKIT_URL` | LiveKit secure websocket endpoint |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Server-side LiveKit credentials |
| `EMAIL_DELIVERY=test`, `disabled`, or `resend` | Operator testing, closed signup, or verified email delivery |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required only when delivery mode is `resend` |
| `CRON_SECRET` | Protected scheduled cleanup |

Optional billing requires all three of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID`. Keep separate Stripe test and live environments. Leave them empty until pricing and paid-access policies are confirmed. This implementation collects a coach subscription if explicitly enabled, but does not enforce paid entitlements for classes yet.

## 5. Vercel project

Connect the GitHub repository to the existing `geez-squad` Vercel project; reuse its configured environment and Neon integration. In [Project Settings → Git](https://vercel.com/aravinds2006s-projects/geez-squad/settings/git), select Connect Git Repository → GitHub. Complete GitHub authorization as the repository owner. When GitHub offers repository access, select only the Geez Squad repository. Return to Vercel and connect it. If the repository is missing, open the Vercel GitHub App installation settings and grant it access to that repository. [Vercel GitHub connection](https://vercel.com/docs/git/vercel-for-github).

Next.js and Node 22.x are already selected. The package engine range `^22.22.0` keeps deployments on Node 22.x with the required minimum; an unbounded `>=` range would select Vercel's newest available major. Set the Production Branch to the branch pushed to GitHub (currently `master`). `vercel.json` uses `npm run build:vercel`; the command rejects missing required secrets, insecure origins, and SQLite production storage. The build copies local camera runtime assets and verifies the pinned model checksum. The deployment has no external AI frame-upload dependency. [Vercel Node version selection](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Add the required values for each deployment environment. Preview builds need their own exact origin, database, auth secret, and video test project. Do not attach a preview to a production database. Apply migrations in the release step, then deploy/verify the preview and promote it. Automatic production deployment is not a substitute for the release gates.

Build a separate preview against isolated test services first. For the final release, build a staged production deployment with the actual production environment:

```sh
npx vercel@62.4.0 pull --yes --environment=production --scope aravinds2006s-projects
npx vercel@62.4.0 build --prod --scope aravinds2006s-projects
npx vercel@62.4.0 deploy --prebuilt --prod --skip-domain --scope aravinds2006s-projects
# Inspect the staged URL, logs, health, and camera asset loading.
# Run authenticated acceptance checks at the configured canonical origin.
# When final service checks pass:
npx vercel@62.4.0 promote <staged-production-url> --scope aravinds2006s-projects
```

Use Linux CI for a prebuilt Vercel artifact so Prisma's native query engine targets the deployment platform. On this Windows workstation, prefer a remote source build with `npx vercel@62.4.0 deploy --prod --skip-domain` after the migration and configuration checks; do not upload a Windows prebuilt native engine.

Staging/promotion avoids automatically serving an unchecked build. A staged deployment uses production configuration; it does not establish acceptance of live video or movement analysis. Auth and API origin guards expect the canonical origin, so a generated deployment URL alone is not a complete authenticated end-to-end test. Run the full flow on an isolated preview with its own exact origin, then complete the final checks on the production origin in a controlled pilot. [Vercel staged production deployment](https://vercel.com/docs/cli/deploying-from-cli).

The included CI performs local checks on Windows/Edge without deploying or sending comments. Keep actual deployment secrets in the provider/CI secret store, never committed. `.vercelignore` excludes environment files, local databases, cached builds and generated camera assets from source uploads; the remote build prepares the pinned camera assets itself. `production:check` rejects missing services, malformed/insecure/local origins, template values, weak/reused cleanup secrets, and partially configured billing without printing secret values.

## 6. Billing and cleanup

Configure Stripe Checkout, a customer portal, and a webhook to `/api/billing/webhook` for subscription create/update/delete and checkout completion. The endpoint verifies the raw-body signature, records event IDs transactionally, and reconciles subscription state with Stripe. Test duplicate, delayed, out-of-order, renewal failure, canceled, and replay scenarios before enabling actual charges.

Vercel's scheduled `/api/retention` job runs daily and requires `Authorization: Bearer <CRON_SECRET>`. It removes expired authentication/invite/rate records, latest metrics older than 7 days, and messages older than 90 days. Confirm the job's successful run from provider logs. Aggregated and detailed workout history, check-ins, assignments, and private notes follow the operator’s published deletion/retention policy; account/studio deletion cascades through related records.

## 7. Before public launch

Complete the service checks in VERIFICATION.md; apply and load-test PostgreSQL; perform independent security and accessibility review; validate pose/cue accuracy with qualified coaches and consenting representative participants; publish privacy, terms, contacts, retention, and deletion policies; verify backup/restore; configure monitoring and spend limits. The current local build is a working pilot, not evidence that those gates are complete.
