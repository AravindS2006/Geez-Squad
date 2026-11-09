# Codebase and requirements audit — 12 October 2026

## Assessment

The application has a coherent architecture for an invited, coach-led fitness studio. Its local inference, authenticated APIs, durable workout history, and separate group-video transport fit that purpose. This audit found and fixed correctness defects across the pose engine, React lifecycle, metrics, transactions, session retrieval, and billing. The local regression checks pass after those changes.

That does **not** establish that every feature is correct in every environment. In particular, the repository does not establish physical-camera accuracy, medical or biomechanical validity, production capacity at the enrollment limit, or universal browser/device compatibility. It is suitable for continued controlled operator testing; the public-launch acceptance work below remains material.

No separate new problem-statement attachment was supplied. The requirements used were README, IMPLEMENTATION_PLAN.md, PHASE_2_PLAN.md, PROPOSAL_REVIEW.md, GEEZ_SQUAD_RELEASE.md, and the subsequent studio/classroom release documentation. Older plans contain initial targets, so this report distinguishes them from implemented behavior and measurements.

The audit changed local source, regression tests, and documentation. It did not deploy, push, change production configuration, or migrate the production database. Integration checks used an isolated SQLite database and disposable accounts; billing route tests used mocked Stripe responses.

## Requirements and architecture review

| Area | Assessment and evidence | Practical limit |
| --- | --- | --- |
| Identity and roles | Better Auth handles sessions/passwords; protected domain requests resolve the authenticated user server-side. Role setup is constrained rather than accepted from arbitrary client payloads. Auth and cross-account API regressions pass. | Testing email mode deliberately does not verify identity through email. Public verification/recovery needs a configured sending domain and delivered-email testing. |
| Studio ownership | Invitations, classes, plans, messages, and client data are scoped to the owning studio or authorized enrollment. Added atomic membership checks for plan assignment and class creation. | PostgreSQL concurrency must also be exercised on the deployment configuration. SQLite tests alone cannot prove its lock/retry behavior. |
| Scheduling and lifecycle | Stored timestamps, participant/capacity checks, guarded editing, class lifecycle, revision checks, removal behavior, and room access have integration coverage. Direct access to older authorized classes is fixed. | Workspace listings still have bounded history rather than comprehensive pagination. |
| Frontend | Coach/trainee journeys, account-scoped save recovery, responsive workspace navigation, camera controls, calibration, and floating coach layout pass browser checks. Inspected representative mobile and 48-person gallery screenshots. | Automated layout/axe checks do not replace manual keyboard, screen-reader, physical touch-device, or usability testing. |
| Local pose inference | MediaPipe runs in a worker; frame cadence and outstanding work are bounded. Model fallback, GPU timeout, CPU recovery, tracking confidence, and cleanup have regression coverage. | A loaded model and stable worker do not prove accurate exercise classification or coaching cues on human recordings. |
| Exercise mechanism | Twelve profiles use confidence gates, stable geometry/limb selection, temporal state, hysteresis, calibration, and range/duration rules. Fixed mixed coordinate spaces and invalid normalized threshold gaps. | Form scores are heuristic agreement with selected landmark rules, not a validated technique or injury-risk assessment. |
| Metrics and history | Current summaries are revision-scoped and bounded. Saved sets freeze metadata and use immutable idempotency keys. Failed saves stay partitioned by account. Delayed initial summaries and inconsistent rep/hold units are fixed. | Clients can fabricate plausible values. These metrics cannot support fraud-sensitive rewards or independent proof of exercise. |
| Live video | Server-issued grants are room/member scoped; video transport is separate from private HTTP analytics. Existing adaptive subscription and teardown mechanisms were reviewed. | This audit did not re-run real LiveKit Cloud, TURN impairment, token revocation, or physical multi-device sessions. Existing historical service evidence is not a fresh result. |
| Privacy and security | Request origin, JSON bounds, schema checks, rate limits, access checks, private-note isolation, export boundaries, and retention paths have code/integration coverage. Corrected the crowded-view claim. | Manual penetration testing, nonce-based CSP hardening, deletion operations, and backup/restore rehearsal remain separate work. |
| Billing | Raw-body signature verification and deduplication are retained. Added reconciliation protection against stale subscription cancellation and concurrent remote reads. | Checkout, portal, and actual webhook retries were not tested against Stripe in this audit. Paid entitlements remain a documented future milestone. |
| Deployment and dependencies | Production build, typecheck, formatting, local migrations, and production dependency audit pass. SQLite and PostgreSQL paths are separated. | Workstation Node is 22.14; project/CI target is Node 22.22+. Final acceptance should also run on that supported runtime. |

## Findings fixed

Severity below describes likely impact, not a formal CVSS rating.

### 1. Bilateral movement could mix 3D and projected 2D angles — high

When the selected limb retained trustworthy world landmarks but the opposite limb lost depth confidence, a bilateral movement could compare angles from different coordinate spaces. A threshold crossing could then be accepted on incompatible geometry.

The engine now requires trustworthy world geometry on both sides before using it for a bilateral movement. A working 3D cycle suspends if that requirement is lost; it does not silently substitute a projected opposite-limb angle. The rule version changes from `profile-v5` to `profile-v6` so new saved estimates can be distinguished from historical results.

Evidence: a targeted jumping-jack regression with low opposite-elbow world visibility failed before the fix and passes afterward. Existing profile, tracking-loss, side/source-lock, continuous curl, and hold tests also pass. Files: `src/lib/pose-engine.ts`, `tests/pose-engine-v3.test.ts`.

### 2. Invalid or missing calibration values could produce incompatible endpoints — medium

`normalizeWorkoutConfig` clamped valid numbers but returned its default unchanged for missing, NaN, or infinite input. When the other endpoint had changed, that default could violate the required separation or order.

Defaults now pass through the same bounds as explicit values. New cases cover all twelve profiles and missing/non-finite endpoints; nine cases reproduced failures before the fix. Files: `src/lib/workout-config.ts`, `tests/workout-config.test.ts`.

### 3. Long-lived camera callbacks could save stale class/revision metadata — high

Worker callbacks can outlive the render that created them. Starting a later set after a coach changed the exercise revision could therefore retain the old `classId` or `revision`, even though current exercise/configuration refs had advanced.

A current session-context ref is read when a set starts, and changing the class also resets the analysis lifecycle. Each active set still freezes its own metadata so an already-started set is not rewritten retroactively. This correction comes from lifecycle/code tracing; the browser suite verifies worker preservation, guided sets, and persistence, but there is not a new dedicated browser assertion for this exact stale-revision case. File: `src/components/camera-analyzer.tsx`.

### 4. A delayed first metrics upload could be rejected indefinitely — high

The first cumulative summary always received a three-second allowance. If the first successful network delivery contained more than six legitimate repetitions, it was rejected. With no accepted baseline, later cumulative retries could remain rejected too.

The first allowance now uses elapsed server time since the later of class start and first consent. Subsequent uploads use the previous accepted timestamp. Rejoining preserves initial consent rather than resetting that baseline. Large implausible jumps remain rejected.

Evidence: the API test now submits twelve repetitions after simulated elapsed time, verifies re-consent preserves the original timestamp, and still rejects a jump to 1,000. Unit cases cover initial, later, and clock-boundary intervals. Files: `src/lib/metric-policy.ts`, metrics/command routes, `tests/metric-policy.test.ts`, `scripts/test-api.mjs`.

### 5. Metrics accepted hold time for repetition exercises and vice versa — medium

The live metric schema bounded both fields independently, allowing contradictory measurement units and misleading summary totals. It now enforces zero repetitions for hold profiles and zero hold seconds for repetition profiles, matching the saved-set contract. Unit and real API rejection checks pass. Files: `src/lib/validation.ts`, `tests/metric-policy.test.ts`, `scripts/test-api.mjs`.

### 6. Removing a client could race with new assignment/enrollment creation — high

Plan assignment and class creation checked studio membership before their writes without placing both operations in a common transaction. A concurrent removal could finish between those steps and leave a removed client newly assigned or enrolled.

Membership checks and writes now run inside serializable transactions using the existing bounded-retry/SQLite serialization helper. The local API regression races removal, assignment, and class creation, accepts valid operation orderings, and verifies no scheduled enrollment or assignment survives removal. Files: `src/app/api/command/route.ts`, `scripts/test-api.mjs`. A deployed PostgreSQL concurrency rehearsal remains necessary.

### 7. An authorized class outside the newest 100 could not open — medium

The studio page searched the bounded workspace list, treating absence from that list as absence of access. A legitimate older class consequently became inaccessible after sufficient newer sessions existed.

Direct studio retrieval now filters by the requested ID together with the existing ownership/enrollment authorization. It does not rely on list rank. Trainee enrollment data is also filtered in the database query. A browser regression creates 101 newer sessions, opens the original class, and starts it successfully. Files: `src/lib/workspace.ts`, `src/app/studio/[id]/page.tsx`, `tests/e2e/auth.spec.ts`.

### 8. Delayed billing events could overwrite a newer subscription — high when billing is enabled

Retrieving a subscription's current Stripe state avoids trusting an old event payload, but it does not prevent cancellation of an older subscription from replacing a customer's newer subscription record. Also, two remote reads can finish in a different order from database commits.

Terminal events for a different previous subscription no longer replace the current subscription. Reconciliation captures the database version before contacting Stripe, then uses a conditional update matching subscription ID and update timestamp. If another event commits meanwhile, the transaction fails and returns a retryable error without recording the event as processed. Deduplication remains transactional.

Eight focused policy/route cases cover old cancellation/expiry, current-subscription handling, replacement, duplicate delivery, invalid signatures, and an intervening concurrent update. The route tests mock external Stripe and database responses; they do not establish real payment processing or PostgreSQL atomicity. Files: billing webhook route, `src/lib/billing-policy.ts`, `tests/billing-policy.test.ts`, `tests/billing-webhook.test.ts`.

### 9. Privacy and operating documentation overstated or lagged behavior — medium

The privacy page implied multiple people would prevent scoring. The configured single-person tracker cannot reliably detect and reject every extra person. The text now explicitly requires one person and discloses that limitation. Operating notes also referred to the old eight-person cap, `geometry-v1`, and missing transaction retries; these are corrected.

This is also an unresolved deviation from the original plan's two-person detection/rejection requirement. Changing the wording does not implement crowd rejection. That behavior needs a deliberate detector/identity design and performance/accuracy validation before it can be promised.

## Fresh verification evidence

| Check | Result from this audit |
| --- | --- |
| Unit suite | **291 passed**, 23 files, including new regression and billing route cases |
| Authentication/API integration | **175 passed** against the final production build and isolated SQLite database |
| Browser suite | **38 passed**, Edge through Playwright's Chromium project; simulated camera/model and layout scenarios |
| Accessibility | **20 scans**, zero reported automated axe violations |
| Closed-signup email mode | **9 checks passed** |
| Testing-signup email mode | **28 checks passed** |
| Production build | Passed; pinned model/WASM preparation, Prisma generation, Next.js compilation and TypeScript |
| TypeScript / formatting / diff | Passed |
| Production dependency audit | Zero known vulnerabilities reported by `npm audit --omit=dev` at audit time |
| Local migrations | All three migrations applied successfully to a fresh isolated SQLite database |

The full browser/accessibility/auth-mode runs preceded the final backend-only billing and metric-unit changes. The final build, full unit suite, typecheck, formatting, and expanded API checks ran after those changes. The full browser suite was not redundantly rerun afterward. No schema change or new package dependency was needed.

Reproduction uses the documented scripts: `npm test`, `npm run typecheck`, `npm run format:check`, `npm run build`; start the production server and run `npm run test:api`, `npm run test:e2e`, and `npm run test:a11y`. The email-mode scripts run isolated servers. Use dedicated test storage and disable real provider credentials for local synthetic checks. On Windows, stop the server before generating Prisma/building.

## Remaining work and acceptance priorities

1. **Validate pose accuracy on annotated human movement.** Measure rep-count error, missed/false reps, cue precision, rejection rate, and tracking coverage per exercise and camera view. Include diverse people, clothing, lighting, occlusion, mobility, and device performance. Calibrate or remove unsupported cues/profiles based on evidence. Synthetic trajectories prove specified algorithm behavior, not general real-world accuracy.
2. **Resolve the crowded-view requirement.** The current one-person configuration and continuity gates cannot guarantee identity attribution or reject every second person. Preserve the single-trainee restriction until an independently tested solution exists.
3. **Run physical-device and network acceptance.** Cover iOS/Safari, Android, lower-end phones, camera rotation, permission changes, backgrounding, long-session thermal throttling, audio interruptions, TURN, reconnect, and cached-token behavior. Confirm local-only practice and group-video consent remain clear in each mode.
4. **Validate production data/service behavior.** Rehearse concurrent class/member operations on PostgreSQL, provider failure/retry cases, delivered verification/reset email, real Stripe test-mode lifecycle, and LiveKit room revocation. Historical cloud results remain useful, but are not current results for this patch.
5. **Measure capacity rather than infer it from UI limits.** `MAX_CLASS_CLIENTS=100` is an enrollment ceiling. Rendering 48 synthetic trainees does not establish 100 simultaneous RTC streams, acceptable inference performance, or safe coach attention. Measure latency, error rate, DB writes, subscriptions, bandwidth, and provider costs at the intended concurrency.
6. **Add complete history navigation if required by the product.** Workspace results cap classes at 100, saved sets at 500, and check-ins at 100. Direct room access is fixed, but these listings/progress views should not be described as unlimited lifetime history. Pagination and explicitly labeled reporting periods need a separate product/data contract.
7. **Complete launch operations.** Practice backups/restores and incident response; implement or operate account deletion with billing/retention handling; conduct manual accessibility and security review. Paid entitlement enforcement and an operator console are still documented future work.

## Research used to assess mechanisms

- Google's [Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) distinguishes normalized image landmarks from world landmarks and documents synchronous detection calls, worker use, and configurable pose count. This supports separating geometry spaces and using a worker; it does not validate this application's thresholds or scores.
- The [BlazePose paper](https://arxiv.org/abs/2006.10204) describes the landmark-estimation approach. Landmark estimation and exercise-technique validation are separate problems; the application still needs its own measured acceptance evidence.
- React's [Effect documentation](https://react.dev/reference/react/useEffect) and [separating events from Effects](https://react.dev/learn/separating-events-from-effects) explain render-specific values and reading current state for long-lived callbacks. The camera fix follows that lifecycle distinction while retaining frozen active-set metadata.
- Prisma's [transaction guidance](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions) documents serializable isolation and retrying `P2034` write conflicts. Moving the read/check and write together addresses the membership race; deployment load testing is still needed.
- Stripe's [webhook guidance](https://docs.stripe.com/webhooks) states that event delivery order is not guaranteed and covers signatures, retries, and duplicate events. The reconciliation changes address application state beyond signature verification alone.
- LiveKit's [room documentation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/) describes the external room/media boundary. Local HTTP/browser tests cannot establish real transport or provider revocation behavior.

The strongest supported conclusion is that the identified defects are fixed and the recorded local checks pass. Claims of universal correctness, validated coaching accuracy, or production readiness would exceed the available evidence.
