# Verification and release evidence

Updated 9 October 2026. Geez Squad is deployed for operator testing at [geez-squad.vercel.app](https://geez-squad.vercel.app). This report records automated evidence and its limits; the GitHub workflow and Vercel deployment identify the exact released commit.

## Coaching workspace and studio management

The [studio management release](STUDIO_MANAGEMENT.md) replaces mixed-person form averages with actionable coach follow-ups and personal trainee progress. It adds guarded scheduled-session editing, roster changes, shared profile editing, direct progress navigation, and deliberate membership removal with history preservation. Existing pose and video behavior remains covered by the regression suite. No schema migration or new dependency is required.

Local acceptance passed: 266 unit cases, 168 real authentication/API checks (including simultaneous meeting edits), 38 Edge browser cases, 20 accessibility scans, both deferred-email auth modes (9 closed-signup checks and 28 testing-signup checks), optimized build, TypeScript, formatting, and a production-dependency audit with zero known vulnerabilities. Browser management tests exercise the UI, API, database, reload, and both trainees' calendars. Release staging checks production build and database health; final canonical acceptance uses temporary synthetic accounts and removes their related records.

## Geez Squad accuracy and coaching release

The [current release](GEEZ_SQUAD_RELEASE.md) adds synchronized camera/landmark rendering, the Heavy model with device recovery, guided range calibration, noise-tolerant form validation, full-roster scheduling and a consistent conference layout. Durable set history, measured progress, assignments, private notes, check-ins and account-scoped retries remain available. Twelve exercise profiles use version `profile-v4`; historical scores retain their original version. Domain-based email and paid billing stay deferred as requested.

| Check | Evidence |
| --- | --- |
| Unit suite | 191 cases across pose trajectories, confidence/source/limb stability, twelve exercise profiles, countdown, hold timing, observed metrics, weighted progress, CSV safety, failed-save ownership/retries, GPU runtime recovery, auth/email policy, calibration and legacy room compatibility |
| API integration | 111 checks against real local auth and SQLite: roles, invitation/class/plan ownership, full-roster scheduling isolated to the owning studio, consent, lifecycle, private messages, origin guards, monotonic summaries, persisted sets, immutable idempotent retries, intended-account protection, assignments, private notes, check-ins, hold totals, and personal export |
| Browser regressions | 28 Edge/Playwright cases. Includes ten continuous front-facing depth curls, native overlay alignment, automatic limb selection, guided range calibration, guided sets, countdown/dropout/stale-camera behavior, auth flows, drawer dismissal, eight- and 24-trainee galleries, all coach sizes/corners, mobile/landscape/4K containment, flat conference surfaces, and persistent progress after a failed save and reload |
| Inference recovery | Real pinned Heavy and Full models load with available and deliberately unavailable GPU backends. A blocked GPU initialization recovers after 15 seconds; a blocked inference recovers after five seconds without fresh results, preserving the camera stream. Five sustained slow Heavy results trigger Full. Worker fault tests cover a lost GPU runtime, one CPU recovery, bitmap transfer/disposal, and terminal CPU failure |
| Accessibility | 20 public/sample page, dialog, populated meeting, and mobile states have zero automated axe violations. Authenticated trainee, floating coach, countdown, and populated progress are also scanned in browser tests |
| Build and source | Optimized Next.js build, TypeScript, asset checksums, Prettier, and diff consistency checked. No new dependency is required; npm audit reports zero known vulnerabilities at this check |
| Database migration rehearsal | Both providers have additive committed migrations. SQLite applies locally. The PostgreSQL room-identity migration was rehearsed in a temporary isolated schema on the existing Neon database, then applied. Legacy sessions retain a null room identity and their original fallback; new room names persist. The prior training-history migration also passed legacy/default, uniqueness and cascade rehearsal. Test schemas were removed |
| GitHub CI | Runs setup, typecheck, formatting, unit tests, dependency audit, optimized build, API tests, all browser tests, accessibility, and both deferred-email auth modes on Windows/Edge with Node 22.22 |

Test accounts use generated `example.test` addresses and are removed after verification. Local integration uses SQLite and simulated camera feeds. Changing layouts preserves existing media nodes and the analysis worker. Screenshots/traces are generated artifacts excluded from Git.

## Measured data and privacy

Observed time accumulates only across nearby camera frames during active sets. Pauses, hidden tabs, and large frame gaps do not add training or hold time. Reliable tracked time weights observed form; completed reps weight quality, range, and tempo. A rejection is counted once per rejected cycle. Missing measurements stay null. Reported load volume is entered load multiplied by counted reps; it is not a camera measurement of force or work.

A saved set has a client-generated idempotency key and frozen exercise/revision metadata. Duplicate retries return the same immutable row. Practice saving is opt-in and captured at set start. Live saves require class access and consent. An interrupted set retains its measured work. Failed saves are partitioned by account in device storage and sent with an intended-account check. One rejected queued record does not block later records. Uploads must arrive within 30 days; class records must fit their class timeline, with a short polling/clock tolerance at completion.

Coaches see their own studio's clients and shared summaries. Trainees see their own analytics, check-ins, and assignments. Private coach notes are omitted from trainee APIs and personal exports. Set/history/check-in deletion cascades with account deletion. The existing retention job removes latest camera metrics after seven days and messages after 90 days; saved history and notes follow the operator's published deletion/retention policy. Raw frames and landmarks are not stored.

## Production verification procedure

Apply the tested additive PostgreSQL migration using the direct connection, then verify new tables/columns without printing credentials. Push only source, tests, documentation, and migrations. Require successful CI for the exact commit, a Ready staged production build for that commit, and canonical-domain assignment to that deployment. Rerun controlled account/progress and LiveKit checks after promotion; remove their exact temporary accounts and rooms.

The previous production release already passed a real LiveKit Cloud room check with a coach and two simultaneous trainees, camera reception, microphone publishing/muting, private cues/help, stable resizing/minimizing, screen and tab-audio sharing, class completion, and room cleanup. These checks are repeated for this release. Cloud transport checks use real RTC connections with simulated camera/microphone sources; they are not physical-device tests.

## Remaining validation boundaries

Automated landmarks verify the rep algorithm and UI, not accuracy on a person's actual phone camera. Annotated trials with qualified coaches across body types, movement variations, clothing, camera views, lighting, device performance, and networks are still needed to quantify rep-count and cue error. The one-person pose model does not establish crowded-view correctness. A camera score cannot certify safe or perfect technique or detect pain.

Representative Safari/Android/iOS/TV hardware, thermal behavior, TURN/reconnect under impaired networks, peak PostgreSQL/RTC load, backup restoration, and independent manual accessibility/security review remain separate acceptance work. Twenty-four enrolled trainees were checked for layout, while production transport checks use a coach and two simultaneous trainees. The enrollment limit of 100 is not a tested concurrency claim. Public email recovery requires the client's verified sending domain. Paid entitlements, recordings and wearable/nutrition integrations remain future work.

## Reproduce

Run `npm run setup`, `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run build`. Start with `npm run start`, then run `npm run test:api`, `npm run test:e2e`, and `npm run test:a11y`. Run `npm run test:email-disabled` and `npm run test:signup` for isolated auth modes. On Windows, stop the server before Prisma generation/build to release its native DLL. Use a dedicated local database.
