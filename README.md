# Geez Squad

A fitness studio management and coaching product built with Next.js, Better Auth, Prisma, LiveKit, and MediaPipe. Includes a public landing page, operations dashboard, member register, membership plans and renewals, payment ledger and receipts, physical attendance, in-studio class booking rosters, enquiry follow-ups, staff directory, and studio details, alongside the existing coach and trainee workspaces, video sessions, workout plans and progress tools. See the [studio product guide](docs/STUDIO_PRODUCT.md) for workflows, database migrations, verification and release boundaries.

**Status:** an earlier coaching release is deployed for operator testing at [geez-squad.vercel.app](https://geez-squad.vercel.app), with Vercel, Neon PostgreSQL, and LiveKit Cloud. The studio management phase is implemented locally and requires the PostgreSQL migrations and deployment described in the [studio product guide](docs/STUDIO_PRODUCT.md). Physical-device accuracy trials, independent review, email/domain setup, and broader public-launch acceptance remain separate work.

## Run locally

Use Node **22.x, at least 22.22.0**. The current workstation has Node 22.14; local checks ran there successfully, but a dependency declares 22.22 as its minimum, so use the documented minimum for deployment/CI. The package engine range keeps Vercel and CI on the same major version.

```sh
npm ci
npm run setup
npm run dev
```

Open `http://localhost:3000`. Setup creates a private `.env` with a random auth secret, applies SQLite migrations, copies the pinned WASM library, and downloads/verifies the pose model. It preserves an existing `.env`. Keep `BETTER_AUTH_URL` equal to the browser origin; use `localhost:3000` consistently even though the server binds to `127.0.0.1`.

- `/demo` — isolated illustrative studio. All people/history are sample data; edits exist only in that page session. Refresh resets them. No demonstration identity can access protected APIs.
- `/demo?view=practice` — real local camera inference; frames stay on the device.
- `/login` — sign up or sign in to your actual workspace.
- `/app` — authenticated account, onboarding and studio. Local accounts and explicitly selected testing accounts can sign in without email verification. Production email delivery requires verified email.
- `/studio/<id>` — membership-protected session room.

For operator testing before purchasing a sending domain, set Vercel Production `EMAIL_DELIVERY=test` and redeploy. The login page offers **Create account**, signs new users in immediately, and explains that emails are unverified and email recovery is unavailable. Accounts retain `emailVerified=false`; use your own addresses and save your passwords. `EMAIL_DELIVERY=disabled` closes production signup/reset while allowing existing verified accounts. The default production mode is `resend`, which requires a verified sending domain and mail credentials. See the [two-account testing guide](docs/TESTING_GUIDE.md).

Create a coach account, then a trainee account in a second browser profile. The coach creates an invitation for the trainee's exact email and shares its link manually. The trainee accepts it; the coach can then enroll that trainee when scheduling a session. Camera practice needs no video service. Group video needs LiveKit credentials.

## Checks

See the [session and exercise-record correction report](docs/SESSION_RECORDS_2026-10-13.md) for scheduling, time-zone handling, meeting access, saved-history fixes, and their verification.

```sh
npm run typecheck
npm test
npm run build
npm run start
# In a second terminal, against the local server:
npm run test:api
npm run test:capacity -- 30 20
npm run test:e2e
npm run test:a11y
# Requires the built app; starts an isolated server/database on port 3001:
npm run test:email-disabled
npm run test:signup
```

The browser test configuration uses an installed Microsoft Edge. Change the channel or install Playwright Chromium if Edge is unavailable. The worker test uses a simulated camera and never accesses a physical camera. API/browser integration accounts use `example.test` emails and are removed afterward. Use a dedicated local test database. The accessibility scan covers 20 page, dialog, populated studio, and mobile states and writes `docs/accessibility-report.json`; the real trainee journey also checks its private-cue studio view. Automated checks do not establish WCAG conformance. On Windows, stop the dev server before `npm run build` or Prisma generation so the query engine DLL is not locked.

## How camera analysis works

MediaPipe Pose Landmarker Heavy detects 33 landmarks in a worker using local model/WASM assets. Sustained slow inference switches from Heavy to Full, then to Lite when needed. Analysis is capped at 20 frames/sec with one inference in flight. GPU initialization or runtime stalls recover through CPU. One-person VIDEO tracking provides native temporal smoothing. Abrupt body relocation requires stable reacquisition; isolated limb jumps and relocating uncertain joints are hidden. Keep a single trainee in view; crowded views are unsupported. Each annotated display pairs the analyzed image with its corresponding landmarks. Workers, bitmaps and owned tracks are released on stop/unmount.

The profile-v7 engine uses image/world geometry, confidence gates, stable limb selection, adaptive movement-signal smoothing, exercise profiles, state transitions, endpoint tolerance, range and duration validation, time-weighted alignment rules, cooldown, and completed-rep quality. Bilateral movements keep both limbs in the same coordinate space. Curl alignment uses the upper arm relative to the torso, including trustworthy depth and changes from the starting torso orientation. It supports squat, push-up, curl, plank, lunge, shoulder press, lateral raise, jumping jack, glute bridge, crunch, row, and side plank. Guided calibration preserves the measured side and geometry as well as the endpoints. Five-second hands-free starting tolerates small posture changes and pauses for temporary tracking uncertainty. Bridge, crunch, and row retain counting, range, and tempo but show no unsupported numeric form/quality score. See the [pose reliability correction report](docs/POSE_RELIABILITY_2026-10-13.md).

Scores estimate visible movement rather than proving safe or perfect technique. Signed-in trainees can save practice history explicitly; live training uses join consent. Set records retain reps/holds, observed active and tracked time, form and rep quality, range, tempo, confidence, rejection counts, and optional reported load. Failed saves queue by account and can be retried without duplicate rows. No calories, heart rate, injury predictions, or body-fat estimates are inferred.

When connected to a class, the trainee analyzes the LiveKit local camera track rather than opening a second camera. Limited summaries are sent every 3 seconds, scoped to that trainee's enrollment and current exercise revision. Coach updates use polling with backoff. Trainee summaries remain private to the trainee and their coach. Video is a consented **group** stream visible to enrolled classmates; the application does not record it.

The coach overview fits up to 36 trainee tiles on desktops, with search, attention filtering, a private detail/cue panel, and pagination for larger classes. Large overviews receive thumbnail video; selecting a trainee promotes their quality. Trainees receive the coach camera by default and optionally view nine classmates at a time. See the [local classroom upgrade and capacity report](docs/CLASSROOM_UPGRADE.md) for HTTP and WebRTC measurements, reproduction steps, and the remaining production/device checks.

## Documentation

- [Codebase audit, fixes, and remaining validation — 12 October 2026](docs/CODEBASE_AUDIT_2026-10-12.md)
- [Current accuracy and Geez Squad release](docs/GEEZ_SQUAD_RELEASE.md)
- [Professional coaching phase plan](docs/PHASE_2_PLAN.md)
- [Research and implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Vercel and LiveKit deployment](docs/DEPLOYMENT.md)
- [Test as a coach and trainee](docs/TESTING_GUIDE.md)
- [Review of the proposed pose implementation](docs/PROPOSAL_REVIEW.md)
- [Release status and verification](docs/VERIFICATION.md)
- [Security, retention, and operations](docs/OPERATIONS.md)
- [Dependency and asset provenance](docs/THIRD_PARTY.md)

Secrets stay in ignored environment files or the hosting provider. Never put LiveKit, auth, Stripe, or database secrets in browser-exposed variables. Vercel uses PostgreSQL, not the local SQLite file; its build command validates required configuration and generates the PostgreSQL client. Database migration is a separate release step.
