# Coaching phase — 24 October 2026

## Product contract

The player offers 36 curated exercises and studio-scoped coach exercises. The existing twelve camera profiles remain **automatic beta**. No exercise is labeled validated automatic without the separate accuracy pilot. The other curated exercises and all custom exercises use manual repetitions or an observed activity timer.

Curl modes are explicit: left, right, both together, and alternating. Ten alternating curls means ten on each arm. Automatic bilateral counting pairs observed overlapping cycles ending within 750 ms, consumes each event once, and retains unmatched arm movements separately. Alternating progress is the lesser per-set arm count. Mode changes require a new set; coach-assigned modes are locked. Anatomical identity is independent of mirrored preview position.

A complete visible movement and a technique estimate are separate results. An elevated upper arm can produce a correction without erasing a completed curl. Wrong exercise posture, insufficient range, unobserved endpoints, implausible motion, sustained tracking loss, and stale frames still prevent counting. Holds accrue only across adjacent valid observations. Wrist–shoulder proximity is not a rejection rule; a zero-degree elbow with two nonzero segments is valid geometry.

Manual curl fallback reports completed pairs for bilateral/alternating work, one repetition per arm. It does not fabricate separate arm measurements or verify synchronization.

## Current architecture map

| Boundary | Source of truth and flow |
| --- | --- |
| App entry | Next.js App Router serves public landing/demo, protected workspace, and direct studio links. Server pages use the authenticated workspace loader. Installed Next.js documentation governs framework changes. |
| Authentication | Better Auth owns credentials/sessions. Security helpers enforce verified production accounts, origin, bounded JSON, validation, and rate limits. |
| Authorization | Studio access, dated primary coach assignments, class hosting, membership eligibility, and revocation constrain the APIs. Staff job titles do not grant access. Class-only hosting does not grant longitudinal history access. |
| Studio operations | Existing memberships/payments, attendance, physical bookings, team, enquiries, and studio APIs remain separate from workout execution and retain regression coverage. |
| Catalog | `exercise-profiles` contains actual measurement implementations. `exercise-library` defines metadata, units, capabilities, and modes. `exercise-access` resolves custom definitions within the authorized studio. Custom definitions cannot register pose profiles. |
| Capture | The analyzer owns solo camera resources. LiveKit owns shared class tracks; inference reuses its local camera. The manual player owns only its optional solo preview. Prejoin releases previews before joining. |
| Inference | Pinned local MediaPipe worker, one frame in flight, Heavy → Full → Lite adaptation, GPU → CPU recovery. Timestamp, media time, and bitmap dimensions travel with each result. |
| Observations | Continuity → joint stability → geometry selection → movement analysis. Drawing uses matching frame/landmark observations. Render smoothing never supplies counting evidence. |
| Counts | v8 independent curl limb states emit identified events. A coordinator implements pairing/alternation. Per-set baselines prevent earlier imbalances advancing a later target. |
| Measurements | Time-weighted metrics consume all events, including two arms completing in one frame. Arm summaries retain counts, observed/tracked time, and average range/tempo. Live generic form percentages become qualitative cues. Historical estimates retain their rule version. |
| Workout runs | Stable occurrence IDs distinguish repeated exercises. Solo assigned plans advance in order; trainees explicitly start subsequent sets. Coaches select the group block while trainees manage sets/rest. Live classes freeze their plan snapshot at start. |
| Persistence | Idempotent client-set UUIDs prevent duplicate saves. Nullable JSON metadata v2 adds run/block identity, source, mode, arms, units, and load basis. Original records remain intact; corrections are append-only and audited. |
| Recovery | Account-scoped failed-save queues and checkpoints retain confirmed progress/rest. Interrupted sets become partial records; continuation needs fresh starting evidence. Save consent is captured at set start and can be withdrawn. |
| History | Stable `(endedAt, id)` cursors. Complete filtered totals, per-user summaries, and exercise/rule-version breakdowns scan authorized results in bounded batches. CSV follows all pages. |
| Live state | Exercise revisions and control sequences order state. Persisted commands/cues trigger server-originated LiveKit invalidations after the HTTP response. Packets carry no messages or measurements. Private notifications target recipient/sender; HTTP snapshots authorize and reconcile data. |
| Compatibility | New requests advertise protocol v2. Older clients receive a reload response before unsupported workouts/modes. Legacy records and queued saves remain accepted. Historical arms/load semantics are not invented. |
| Operations | Authenticated coarse startup/inference/tracking/save/reconnect/staleness events; arbitrary payload fields are rejected. No frames, joints, message contents, or device identifiers are uploaded. |
| Delivery | Additive SQLite/PostgreSQL measurement and snapshot migrations; Node 22.22 CI and separate disposable PostgreSQL rehearsal. Global/studio rollout controls apply to newly opened players. |

## Returning access, nutrition, and daily operations

Signed-in visitors to the public root now return to `/app`. `/login`, including stale verification links, already resolves a valid verified session to its authorized destination. A successful password response without a usable session now explains the cookie/session problem; it does not infer that email is unverified. Verification mode is entered only for an explicit verification request, an unverified account, or a signup awaiting email. Verification links establish a session using Better Auth's supported option. Production verification enforcement is retained, including previously unverified testing accounts. No existing account is silently marked verified.

**Nutrition** is available to members and coaches from navigation. Members can add, edit, and delete dated food/water entries with optional energy/macronutrients; missing values remain unknown. Daily totals and a seven-day journal view are computed from saved entries. Targets, food preferences, dietary requirements, and agreed guidance are explicitly entered, not prescribed by an algorithm. Sharing is off by default. It grants the current primary coach or studio admins access only while the studio connection and role remain active; coach reassignment, sharing withdrawal, and role revocation are rechecked on every request. Journal editing is reserved for its owner. Target edits are attributed and audited. Account export includes nutrition data. Deleting a user cascades these records.

`GET /api/nutrition` accepts an authorized `userId` and an India-calendar `date` and returns that date and six preceding days. `POST /api/nutrition` supports `entry`, `remove`, `sharing`, and `targets`. UUID entry identities make retries idempotent; up to 100 entries per day are allowed within the preceding year. Nutrition values and guidance never enter operational logs or LiveKit packets.

Daily studio management adds renewal priorities, active members without recent physical visits, missing primary-coach assignments, and a seven-day authorized-coach studio workload table. Physical-class creation/rescheduling checks trainer and normalized room overlaps; live-class scheduling also checks the trainer's physical classes. Back-to-back classes remain allowed. Admins can correct an incorrect attendance check-in with a required reason; the removed visit identity, date, member, actor, and reason remain in the audit history. Staff directory edits continue to be separate from account-role grants. Existing payment/membership safeguards remain in place.

The solo practice screen has a large contained preview, a dedicated movement guide, camera positioning instructions, visible history consent, and a distinct plan sequence. The live coach overlay uses measured preview bounds rather than assuming that the preview begins at the top of its wrapper. Resizing and coach layout changes retain camera and video nodes.

## Progressive web app

`/manifest.webmanifest` supplies standalone launch, icon sizes, maskable icon, and practice/nutrition shortcuts. Production registers `/sw.js` on secure origins; installation UI follows browser support, with Safari home-screen instructions. HTTPS remains required outside localhost. App activation waits for existing windows to close and never forces a class reload. Sessions remain governed by ordinary secure cookies and server authorization.

The worker caches only `/offline.html` and public app icons. It never stores authenticated pages, API responses, nutrition data, video, landmarks, or inference assets. Navigation uses the network, with a public offline fallback when disconnected. Reconnecting returns through normal authentication; offline classes and account editing are unavailable. Existing explicit workout checkpoints/save queues retain their separate, account-scoped behavior. Browser installation and device camera/thermal performance still require the physical-device acceptance matrix.

Additive migration order: `20261024000000_coaching_measurements`, `20261024010000_workout_snapshot`, `20261024020000_nutrition`, `20261024030000_operation_corrections`. Both SQLite and PostgreSQL migrations are supplied. Apply migrations before starting a newer server; rollback must preserve these additive columns/tables and completed records. These checkout changes have not been published to the deployed service.

## Interfaces

- `POST /api/exercises`: coach-created manual/timed definitions; admin-only rollout controls. Limit: 200 custom studio exercises.
- Plan commands accept block IDs, mode, unit, and load basis. Saving resolves studio definitions and rejects duplicate block IDs/unsupported modes.
- Class exercise control accepts `blockId`; the live snapshot survives edits to the reusable plan.
- Metrics/set endpoints accept v2 metadata while retaining enrollment, consent, membership, revision, plausibility, and idempotency checks. Manual records cannot claim inferred scores, confidence, ranges, or tracking time.
- `GET /api/workout-history`: `days`, `limit`, `exercise`, `source`, `timeZone`, optional `userId`, coach `cohort=true`, and opaque cursor. First-page response includes complete summaries/breakdowns. Every page independently applies authorization.
- `POST /api/workout-sets/corrections`: correction UUID, set ID, effective reps/hold time, and reason. Owner/current authorized coach only. Original measurements remain unchanged.
- Unspecified historical load semantics are excluded from volume. Per-hand volume requires known limb counts/mode; total external load uses movement counts. Corrections affect effective volume while original quality remains attributable to the observed movement.

## Verification

Use Node 22.x, at least 22.22.0. The isolated runner uses `test-results/coaching-phase.db`, a local-only auth secret, test email mode, and disabled external video/billing credentials. It does not overwrite environment files.

```sh
node scripts/local-coaching-check.mjs build
node scripts/local-coaching-check.mjs serve
# Separate terminal:
node scripts/local-coaching-check.mjs unit
node scripts/local-coaching-check.mjs api
node scripts/local-coaching-check.mjs roles
node scripts/local-coaching-check.mjs studio
node scripts/local-coaching-check.mjs coaching
node scripts/local-coaching-check.mjs next
node scripts/local-coaching-check.mjs e2e
node scripts/local-coaching-check.mjs a11y
```

Playwright output is isolated under `test-results/browser-runs`, protecting the running database/runtime. The SQLite rehearsal retains legacy credentials/sessions. `npm run db:coaching:postgres` requires `psql` and a dedicated local PostgreSQL service. It creates a unique temporary schema, applies the full PostgreSQL chain, and checks legacy retention, JSONB metadata, and corrections. It never connects to Neon production.

## Acceptance matrix

### Local evidence from this implementation

- Runtime: official Node 22.22.0, with the downloaded archive verified against the official SHA256 manifest. The runtime and all test databases are ignored local artifacts.
- Production compilation and TypeScript pass. Prettier and `git diff --check` pass.
- Unit suite: 399 passing, one opt-in pilot evaluation skipped because no consented manifest was supplied.
- Browser suite: all 55 non-optional cases pass across the full run and targeted reruns after fixes. Coverage includes real model startup/recovery, four continuous-curl noise/device layouts, independent bilateral persistence, manual history/corrections, five-viewport coach layout and media-node preservation, queued-save pagination, returning login, nutrition, and PWA offline/reconnect. Three consented-video benchmarks are skipped. This does not substitute for the physical pilot.
- API checks: 179 core/auth/lifecycle, 111 role/assignment/revocation, 68 studio operations, 49 workout contracts, and 50 nutrition/privacy/management checks pass against disposable local fixtures. Separate email modes pass nine deferred-delivery and 28 testing-signup checks.
- Accessibility scan: 31 page/dialog/mobile scenarios, zero automated violations. Automated checks are not a complete WCAG conformance assessment.
- SQLite additive migration rehearsal passes, retaining legacy credentials, session tokens, verification flags, and history. All eleven migrations are applied to the local test database and checkout's local `dev.db`.
- PostgreSQL SQL rehearsal is wired into CI and includes legacy records, arm JSON, custom exercises, corrections, nutrition privacy defaults, and correction-reason JSON. It was not executed on this workstation: `psql` is absent and Docker's local engine is not running. Production/staging PostgreSQL is unchanged.
- No consented research videos, held-out participant pilot, real-device accuracy claims, hosted notification latency results, or 36-trainee WAN/thermal soak results were produced. The three real-video benchmark cases remain skipped without footage. Automatic exercises remain beta.

| Gate | Requirement | Status |
| --- | --- | --- |
| Counting | Overlap, independent sides, pairing, occlusion, duplicates, per-set baselines, positive/negative cases | Automated regressions |
| Records | Manual/timed source, retries, corrections, pagination, frozen class plan | Isolated API/browser checks |
| UI | 1/4/12/36-person layouts, stable media nodes, mobile controls, keyboard/contrast | Browser fixtures/accessibility; physical usability separate |
| Model | Real pinned model loading and CPU/GPU recovery | Automated browser checks; no physical accuracy claim |
| Coverage | ≥300 reps, 30 positive sets, ten held-out participants per promoted exercise/mode; twenty participants overall; thirty negative sequences | Consented pilot pending |
| Rep accuracy | ≥99% precision, ≥97% recall, ≥95% exact-count sets in supported conditions | Pilot pending |
| Holds | Within one second on ≥95% of annotated thirty-second trials | Pilot pending |
| Technique/angles | Separate cue review; physical reference for anatomical angles | Unvalidated |
| Devices | Windows Chrome/Edge/Brave, macOS Safari/Chrome, Android Chrome/Brave, iPhone/iPad Safari; reported iQOO/Lenovo setup | Hardware matrix pending |
| Group operation | Sixty minutes, one coach plus 36 distributed trainees, inference/reconnect/thermal/network stress | Production WAN/hardware trial pending |
| Latency | p95 commands/cues <1 s, metrics <6 s, count feedback <300 ms | Provider/device measurement pending |
| Promotion | PostgreSQL rehearsal, staging migration, provider checks, compatible rollback | CI/staging acceptance required |

### Local pilot evidence

Enable **Record tracking report locally** and download the JSON. Reports retain at most 600 frames or one minute with no video/audio. Research footage requires separate explicit consent; ordinary classes remain unrecorded. Use pseudonymous participant IDs and an ignored/local research folder.

Example local manifest (paths are workspace-relative or absolute):

```json
{"clips":[{
  "participantId":"participant-01","setId":"curl-left-01",
  "partition":"evaluation","consentConfirmed":true,"physicalDevice":true,
  "exercise":"curl","device":"android-chrome","model":"full",
  "tracePath":"test-results/pilot/curl-left-01.json","expectedReps":2,
  "repetitions":[{"side":"left","endedAt":11400},{"side":"left","endedAt":13700}]
}]}
```

Annotations use diagnostic performance-clock timestamps. Participants cannot overlap `tuning` and `evaluation` partitions. Include partial/occluded/wrong-movement negatives with `expectedReps: 0`; holds use `expectedHoldMs`. Split at set boundaries and include starting evidence. Truncated traces cannot establish unobserved movement.

```sh
npm run pose:evaluate -- test-results/pilot/manifest.json test-results/pilot/report.json
npm run pose:evaluate -- test-results/pilot/manifest.json test-results/pilot/report.json --release-gates
```

The optional real-video benchmark is separate: set `GEEZ_POSE_VIDEO` to consented local Y4M footage and `GEEZ_POSE_ANNOTATIONS` to JSON annotations, then run `pose-benchmark.spec.ts` through the isolated runner. It exercises capture and pinned Heavy/Full/Lite workers. Include sufficient lead-in for model startup/countdown and annotated complete movement intervals (`startedAt`, `endedAt`, `side`) in the observed window. `mediaTimeMs` aligns source video with capture. Record annotation `durationMs`, `exercise`, `armMode`, `participantId`, `device`, and `consentConfirmed: true`. Simulated camera transport does not replace phone-camera/thermal trials.

### Rollout

Admin **Workout plans → Exercise library → Studio coaching rollout** controls newly opened players. Emergency build-time switches: `NEXT_PUBLIC_COACHING_MEASUREMENT=off`, `NEXT_PUBLIC_COACHING_LIBRARY=off`, `NEXT_PUBLIC_COACHING_MEETING=off`. Measurement-off offers labeled manual/timed tracking. Active players pin their controls; reopen to apply changes.

Rollback application code only to a schema-compatible version. Retain additive tables/columns and v2 records. Pilot reports never automatically promote profiles. Publish evidence by exercise, mode, device, and model, retaining beta/manual labels wherever evidence is incomplete. General exercise classification, class recording, new billing products, payroll, native apps, and wearables remain outside this phase.
