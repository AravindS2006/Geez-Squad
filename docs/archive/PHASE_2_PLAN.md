# Professional coaching phase 2

Prepared 9 October 2026. This release prioritizes useful coach/trainee workflows and measured data, with live-session alignment as the first visual concern.

## Audit findings

The current release has a capable local rep engine and live group transport, but persistent analytics contain only aggregate reps and sampled posture scores. Hold totals, completed sets, observed training time, rep quality, range, tempo, tracking coverage, and per-exercise history are missing. Practice history is lost on navigation. Assigned plans are only attached to classes. Client profiles lack check-ins and private coach notes. Meeting styling mixes older card rules with several appended layout overrides, and connection quality is observed without being explained to the user.

## Implementation and acceptance

1. Add durable, idempotent workout-set records for signed-in practice and consented live training. Store exercise/rule version, target/completed amount, observed hold time, active/tracked time, average observed form, completed-rep quality, range, tempo, confidence, rejected cycles, and optional reported load. Rehearsal, pauses, hidden tabs, and missing camera intervals must not create training time or phantom reps. A failed save stays visible and can be retried.
2. Build useful progress views: exercise/client/date filters, total reps and holds, completed sets, observed active minutes, volume from manually entered load, training consistency, tracking coverage, per-exercise trends, recent set history, and CSV export. Missing measurements stay unavailable. Retain legacy summaries without double-counting them as new set records.
3. Add coach plan assignment, private client notes, and trainee check-ins (reported effort, energy, soreness, sleep, optional bodyweight). Validate ownership on every read/write; a trainee sees only their own private data and assignments. No camera-derived heart rate, calorie burn, body fat, or medical scores are invented.
4. Clean the live meeting structure and visual tokens. Use consistent video fit, borders, shadows, header/dock sizing, and bounded coach picture-in-picture placement. Add selectable floating position, local view mirroring, participant connection indicators, coach roster/attention details, and coach-audio volume. Preserve the same video/audio nodes and pose worker during layout changes. Keep all eight trainee tiles available to the coach.
5. Improve motion reliability through measurable diagnostics: model/backend/FPS, confidence, geometry source, tracking coverage, completed quality, and rejection reasons. Recover a lost GPU runtime through CPU once; preserve local camera ownership. Add targeted pose regressions where audit exposes real failures, without weakening confidence or counting unobserved motion.
6. Extend full-flow verification for role isolation, persisted sets and check-ins, retry idempotency, assigned plans, hold/time aggregation, mobile landscape, camera containment, screen sharing, audio continuity, and maximum-capacity galleries. Build both database providers with additive migrations, test the exact commit in CI, deploy only after checks pass, and verify the production domain and Cloud transport.

## Operational boundaries

This is the next coherent product phase, not a claim that every possible premium feature is complete. Domain-based email and paid billing remain disabled until their previously agreed configuration is supplied. Recording, wearable integrations, nutrition prescriptions, and larger class limits require separate product and privacy decisions. Monocular pose scores remain estimates; physical accuracy needs annotated real-camera trials.

Research: [MediaPipe Web inference](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [LiveKit media subscriptions, volume, and adaptive stream](https://docs.livekit.io/transport/media/subscribe/), and [LiveKit connection and device events](https://docs.livekit.io/reference/client-sdk-js/enums/RoomEvent.html). API usage is checked against the installed SDK types and this repository's installed Next.js guides.
