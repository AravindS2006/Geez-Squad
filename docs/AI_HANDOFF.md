# Geez Squad: project context for coding agents

Last reconciled with source: 24 October 2026. Start here and in the root
`AGENTS.md`; `CLAUDE.md` imports that entry point. Source and current test results
take precedence over claims in older phase reports. Read the current user request
and Git status before making changes, and preserve work belonging to the user.

## Product and supported scope

Geez Squad is a studio management and online fitness coaching application. Admins
manage a studio, members, team, memberships, payments, physical classes and bookings.
Coaches train assigned members and host authorized live sessions. Trainees join
classes, practice independently, review workout history and keep a nutrition journal.
Public signup does not grant admin/coach privileges. Staff directory titles and
authenticated application roles are separate concepts.

The live coaching target is one desktop coach supervising up to 36 trainees, with
one person per camera. That is a product target, not evidence of a successful
36-device production soak test. Ordinary sessions are not recorded. Camera frames
are analyzed locally; saved metrics and optional local diagnostic traces have
different privacy rules.

Keep the existing providers and branding. Native apps, wearables, class recording,
payroll and new billing products are outside the current phase unless requested.

## Runtime and first local run

Use Node 22.22+ within the declared Node 22 major. Check `package.json` for exact
dependency versions and supported commands instead of assuming familiar Next.js APIs.
This project uses the App Router, React client components, plain CSS/CSS modules,
Prisma, Better Auth, LiveKit and a MediaPipe worker.

```sh
npm ci
npm run setup
node scripts/local-coaching-check.mjs build
node scripts/local-coaching-check.mjs dev
```

`setup` preserves an existing `.env`, or creates a random local auth secret and a
SQLite development configuration when absent. Inspect configuration by key/status,
never by dumping values. `local-coaching-check.mjs` overrides the database to the
ignored `test-results/coaching-phase.db`, disables external video/mail/billing,
and uses disposable test authentication. Its `build` initializes that database and
generates the SQLite client. `dev` serves source on localhost:3000; `serve` serves
the production build. Run one server at a time. On Windows stop it before production
builds or Prisma generation to avoid locking the query engine DLL.

In a second terminal use the same runner for `unit`, `api`, `roles`, `studio`,
`coaching`, `next`, `e2e`, and `a11y`. Using the runner for both server and tests
keeps their database and auth configuration aligned. Tests use `example.test`
accounts and synthetic media. Do not invoke fixture scripts against a hosted URL
or a production database just because credentials happen to be present.

`/demo` is an illustrative, in-memory workspace. `/demo?view=practice` performs
actual local camera analysis when enabled, with no saved customer history.
`/app` is authenticated. `/studio/[id]` checks class eligibility and permissions.

## Architecture map

| Area | Entry points and responsibilities |
| --- | --- |
| Routes and app shell | `src/app/`, `src/components/workspace.tsx`, `src/lib/workspace.ts`; server loads authorized workspace data, client renders selected views |
| Authentication | `src/lib/auth.ts`, `auth-client.ts`, `email-policy.mjs`, `login-destination.ts`, login/auth routes and `auth-form.tsx` |
| Authorization | `studio-access.ts`, `studio-team.ts`, `member-access.ts`, `exercise-access.ts`, `nutrition-access.ts`, `video-grants.ts`, `security.ts` |
| Mutations | `src/app/api/command/route.ts` is the central authenticated command dispatcher; feature routes implement their own guarded reads/writes |
| Physical studio operations | `studio-operations.tsx`, `studio-operations-server.ts`, `studio-bookings.ts`, team/classes/bookings/membership API routes |
| Live sessions | `studio.tsx` owns meeting state, room, tracks, controls, reconciliation, private cues and device preferences |
| Coach video UI | `coach-monitor.tsx` owns stable roster order, density, paging, search, attention and focused trainee details |
| Screen sharing/devices | `meeting-presentation.tsx`, `video-devices.tsx`, `join-devices.ts`, `meeting-policy.ts` |
| Solo practice | `camera-practice.tsx` owns movement/assigned-plan navigation and the optional guide; it renders `WorkoutPlayer` |
| Workout execution | `workout-player.tsx` chooses automatic/manual/timed execution, warm-up, set/rest progression and measurement source |
| Camera pipeline | `camera-analyzer.tsx`, `camera-access.ts`, `use-camera-layout.ts`, `public/pose-worker.js` |
| Counting and evidence | `pose-engine.ts`, `pose-geometry.ts`, `pose-joints.ts`, `pose-continuity.ts`, `exercise-profiles.ts`, `rep-events.ts` |
| Configuration and contracts | `exercise-library.ts`, `catalog.ts`, `workout-config.ts`, `workout-run.ts`, `measurement-contract.ts`, `validation.ts`, `types.ts` |
| History and corrections | `workout-save.ts`, history/totals/progress modules, workout-sets/history/corrections API routes and `training-progress.tsx` |
| Nutrition | `nutrition-manager.tsx`, `nutrition.ts`, `nutrition-access.ts`, `/api/nutrition` |
| Persistence | `prisma/schema.prisma`, paired `prisma/migrations/` and `prisma/postgres/migrations/`, `src/lib/db.ts` |
| PWA | `src/app/manifest.ts`, `public/sw.js`, `public/offline.html`, `app-install.tsx` |
| Deployment | `vercel.json`, `scripts/production-check.mjs`, `production-config.mjs`, `postgres.mjs`, `.github/workflows/ci.yml` |

Names above without directories refer to `src/lib/` unless shown as components.
Trace the relevant flow from UI through API/auth to database and back; do not fix
an authorization problem only by hiding a button.

## Camera and counting contracts

The observation path is camera → captured bitmap → worker inference → continuity
and joint validation → exercise geometry → per-limb states → rep events → technique
feedback → workout/metric summaries. The worker imports local MediaPipe assets
prepared by `scripts/prepare-assets.mjs`. Model, WASM and vision bundles are
generated/ignored rather than committed. Check their HTTP status when startup fails.

Heavy is attempted first, with GPU/CPU recovery and sustained-latency fallback to
Full and Lite. Only one inference is in flight. The analyzed image and landmarks
are presented together. Rendering smoothing, camera mirroring and UI resizing must
not invent counting evidence, swap anatomical left/right, or replace the active
camera stream. Stop owned tracks and workers on exit, but never stop a borrowed
LiveKit track when an analyzer changes layout or tracking mode. Late permission
grants after cancellation/timeout must be stopped; manual preview shares that rule.

Curl modes are explicit: left, right, both together, alternating. Bilateral reps
require paired overlapping arm cycles; alternating target progress is the lesser
arm total. One-arm movement does not advance bilateral targets. Freeze mode during
a set. Preserve separate arm events, ranges and tempo; do not assume the total
increments by exactly one. Count observed full movement independently of technique
feedback. Brief uncertainty preserves observed evidence without adding hidden time
or endpoints. Sustained loss or incompatible geometry requires fresh readiness.

The 36-exercise catalog separates definitions from measurement capabilities. The
12 original camera profiles remain automatic beta. Other exercises are manual or
timed until individual validation gates pass. Custom exercises are studio-scoped
and cannot acquire automatic support by copying thresholds. Never claim clinical
angle accuracy, safety, calories or physical pilot precision from unit tests.

Use `pose-diagnostics.ts` and `pose-replay.ts` for opt-in local evidence. No camera
frames, landmark traces or research recordings are automatically uploaded.

## Plans, records and privacy

- A workout has stable run and block identities. The same exercise may appear more
  than once; never identify a block only by its exercise ID.
- A class uses a frozen workout snapshot and revision/sequence reconciliation.
  Changes finalize observed partial work rather than silently dropping it.
- Confirmed progress/checkpoints and pending saves are scoped to the authenticated
  account. Saves are idempotent and retries must not create duplicate sets.
- Corrections retain original automatic/manual measurements, author and reason.
  Effective totals are derived; live automatic counters never decrease.
- Per-hand versus total external load is explicit. Do not invent semantics for
  legacy records or fabricate historical left/right counts.
- History uses cursors and server-filtered aggregates, not totals of the first
  500 loaded rows.
- Nutrition sharing is off by default. Recheck the current coach assignment and
  studio scope on reads and writes; staff status alone is insufficient.
- Membership expiry, role changes, coach reassignment and session revocation affect
  active room access. Keep HTTP authorization even when LiveKit notifies clients.

## Live coaching and UI ownership

Authenticated HTTP snapshots are the reconciliation fallback. Persist coach
commands/private cues before server-originated notifications. Sequence/revision
checks ignore stale notifications. Private cues target only the trainee; metrics
are restricted to authorized coaching views. Keep adaptive streaming, simulcast
and selective subscriptions: subscribe to the visible page plus the focused user,
and request higher quality only for focus. Keep stable alphabetical tile positions.

The new room geometry lives in `meeting-workspace.module.css` and practice geometry
in `camera-practice.module.css`. Shared appearance/legacy fallback lives in
`src/app/meeting.css` and older `globals.css` selectors. `next-phase.css` contains
nutrition/PWA/operations styles. Edit the owning module instead of adding another
global size override. Meetings/practice intentionally hide the regular workspace
chrome; they provide their own back navigation and persistent controls.

The coach's normal gallery has 12 trainees per desktop page and four per phone page;
the explicit overview supports 36. Workout queue/search tools are collapsible so
they do not consume the camera area. Metrics and the control dock float without
cropping full-body video. Focused trainee details enlarge the selected feed.
Trainee layout defaults to Balanced, with Picture in picture and Coach focus
options. Saved user preferences remain respected.

Layout changes must preserve the analyzer DOM node, tracks, playback and counters.
Use `contain` for full-body camera/presentation media, keep video/canvas bounds
aligned, avoid covering important overlays, honor safe areas, provide 44px primary
controls and visible keyboard focus, and test short landscape screens.

## Verification matrix

| Change | Minimum relevant evidence |
| --- | --- |
| Any source change | `npm run typecheck`, `npm run format:check`, relevant unit tests, `npm run security:scan` before publication |
| Camera startup/lifecycle | `tests/camera-access.test.ts`, `tests/e2e/video-workspace.spec.ts`, `model.spec.ts`, `capture-resize.spec.ts` |
| Meeting/practice UI | Desktop + phone + landscape screenshots, `coach-layout.spec.ts`, `meeting-gallery.spec.ts`, practice/next-phase cases, axe scans and no page errors |
| Pose/counting | Engine/geometry/continuity/replay/calibration/measurement tests, guided/curl browser tests; use participant-disjoint consented physical trials for accuracy claims |
| Access/API | API, roles, studio, coaching and next-phase scripts against the isolated server; cross-studio and reassignment cases |
| Schema/records | Additive SQLite rehearsal plus independent PostgreSQL CI job, legacy/queue compatibility and correction/history tests |
| Release | Supported runtime production build, required CI gates, deployment health/auth barriers, correct production alias and documented recovery |

The browser configuration uses installed Edge and synthetic media. `model.spec.ts`
also executes the real WASM model. Synthetic landmark correctness and complete
video-to-count accuracy are separate validation layers. No browser test proves
physical device accuracy or a 60-minute distributed LiveKit class.

Playwright may clean `test-results/browser-runs`. Keep database/runtime helpers
outside that subdirectory. Screenshots and traces stay local/ignored. CI does not
publish them, because traces can contain cookies and request bodies.

## Deployment and security boundaries

GitHub: `AravindS2006/Geez-Squad`; default branch `master`. Production:
`https://geez-squad.vercel.app`. Vercel's build command is `npm run build:vercel`.
Production uses PostgreSQL; local verification uses SQLite. Migrations use a direct
connection; runtime uses the provider's runtime connection. Generated PostgreSQL
schema/client files are not the source of truth.

Use additive migrations for both providers and verify PostgreSQL independently.
The CI PostgreSQL container is loopback-only and receives a fresh random credential;
the rehearsal rejects remote database hosts. A successful SQLite check alone is
insufficient. Do not create temporary schemas in production for rehearsals.

Use hosting metadata/authenticated access to verify deployment configuration. Never
export all production secrets, copy them into previews, weaken deployment protection,
or create public share links just to run a health check. Preview builds without
provider configuration may intentionally fail their prerequisites. Apply the user's
current release authorization and verify the actual alias after a promotion.

Read `SECURITY.md` before publishing. GitHub secret scanning/push protection and a
local pre-push guard reduce exposure risk. Install checksum-verified Gitleaks and
run `npm run security:install-hooks` in a new checkout. Never commit `.env`, keys,
cookies, databases, `.vercel/`, local reports or camera recordings. Environment
templates contain only blanks/placeholders. The historical GitGuardian alert in
PR #1 was a disposable test credential, not a production password; see
`SECURITY_AUDIT_2026-10-24.md`. Do not rotate production credentials based only on
that old alert or suppress an unfamiliar new finding without investigation.

## Deeper references and known open gates

- `COACHING_PHASE_2026-10-24.md`: measurement/data contracts, curated library,
  rollout switches, pilot targets and the initial phase's architecture acceptance map.
- `DEPLOYMENT.md`, `OPERATIONS.md`, `SECURITY.md`: environment/recovery and secrets.
- `BUG_AUDIT_2026-10-23.md`: account roles, assignments and feedback boundaries.
- `pose-engine-v3.md`, `POSE_RELIABILITY_2026-10-13.md`: historical algorithm context;
  inspect current implementation/rule versions before reusing old assumptions.

Physical exercise validation, the device matrix (including iPhone Safari), and a
distributed 36-trainee soak test still require consent, people and devices. Keep
automatic capabilities beta and manual fallback available until their gates pass.
When delivering a change, record the exact checks run and anything awaiting real
device validation. Update this map when ownership, commands or contracts change.
