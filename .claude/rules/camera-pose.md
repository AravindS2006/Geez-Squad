---
paths:
  - "src/components/camera-*.tsx"
  - "src/components/camera-practice.module.css"
  - "src/components/workout-player.tsx"
  - "src/components/use-camera-layout.ts"
  - "src/components/coach-monitor.tsx"
  - "src/lib/pose-*.ts"
  - "src/lib/camera-access.ts"
  - "src/lib/rep-events.ts"
  - "src/lib/exercise-profiles.ts"
  - "src/lib/movement-calibration.ts"
  - "src/lib/measurement-contract.ts"
  - "public/pose-worker.js"
---

# Camera and counting contract (non-negotiable)

Pipeline: camera → captured bitmap → worker inference → continuity and joint validation →
exercise geometry → per-limb states → rep events → technique feedback → summaries.

- **Ownership**: stop the tracks and workers you own on exit, and close every `ImageBitmap`.
  Never stop a borrowed LiveKit track when the layout or tracking mode changes. Stop a
  permission grant that arrives after cancel or timeout (manual preview too).
- **Stable DOM**: layout changes must not remount the analyzer `<video>`/`<canvas>`, replace
  the active stream, or reset counters. Change CSS, not the element tree.
- **One inference in flight.** The analyzed image and its landmarks are presented together.
  A timer backs up stalled `requestVideoFrameCallback`.
- **Count only observed frames.** Smoothing, mirroring and resizing must not create
  evidence or swap anatomical left and right. Brief uncertainty keeps evidence and adds no
  hidden time. Sustained loss requires fresh readiness.
- **Curls**: left, right, both or alternating are explicit and frozen during a set.
  Bilateral reps need paired overlapping cycles. Alternating progress is the lesser arm
  total. Do not assume the total increments by exactly 1.
- **Records**: automatic counts are monotonic. Corrections are append-only and keep the
  original measurement, the author and the reason.
- **Capability**: only the 12 original profiles are automatic (beta). Everything else is
  manual or timed. Custom exercises never gain automatic support by copying thresholds.
- **Runtime selection**: desktop tries Heavy first. iPhone and iPad start on Full via
  `pose-browser.ts`. GPU→CPU and Full/Lite fallbacks stay bounded.

Evidence: `tests/pose-*.test.ts`, `camera-access.test.ts`, and the e2e specs
`video-workspace`, `model`, `capture-resize`, `curl-tracking` and `guided-workout`. Synthetic
tests are not accuracy claims, so never claim clinical or physical accuracy.
Before editing, read `docs/AI_HANDOFF.md` → "Camera and counting contracts".
