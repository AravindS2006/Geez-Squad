# Camera workspace and coaching room repair — 24 October 2026

## Reproduced problems

The practice view rendered a blank options bar when the sample user had no plan or
history controls. Large fixed minimum heights, the workspace sidebar/header, and a
permanent guide pushed the camera's action area below the viewport. Browser tests
that automatically scrolled to buttons did not catch that usability problem.

The coach room spent vertical space on a permanent workout queue, large toolbars,
separate metric rows and a full-width controls area. Four participants at a
1280×720 viewport had camera feed slots only about 134px high in the reviewed UI.
Older global mobile grid rules also conflicted with newer room styles.

The real MediaPipe worker's GPU recovery test succeeded with a synthetic camera;
a universal inference failure was not reproduced. A pending camera permission
request could nevertheless wait indefinitely, and manual preview had no cleanup
for a permission grant arriving after its component was removed.

## Changes

- Practice is a dedicated viewport-sized workspace with back navigation, a compact
  exercise picker, visible camera controls, and an optional floating movement guide.
  Empty settings bars and the permanent side guide no longer consume the viewport.
  Assigned workout sequences remain available in a disclosure without shrinking
  the camera all the time.
- The coach gallery overlays names, tracking state and metrics on the feed. The
  workout queue and compact-screen search tools open on demand. Normal paging is
  12 trainees on desktop and four on compact screens; the 36-person overview is
  still explicit. Tile order remains stable, and focus enlarges the trainee video.
- The rounded control dock fits its content and wraps when a live connection adds
  more actions. Its height participates in layout, reserving camera space instead
  of covering the last tiles. Leave and End remain distinguishable on phones.
- Trainees start with Balanced coach video; Picture in picture and Coach focus are
  available, with saved preferences respected. Layout changes keep the same camera
  and analyzer nodes. Full-body media still uses `contain`.
- Camera setup distinguishes pending permission from model preparation, supports
  cancellation and a finite permission deadline, and exposes failure guidance in
  the visible camera area. Late grants after timeout/cancellation are stopped.
  Manual preview uses the same acquisition ownership rules.
- Camera/meeting geometry now has focused CSS modules. The practice component is
  extracted from the workspace shell. Global workspace chrome is hidden only while
  a dedicated camera/meeting workspace is present.
- `AGENTS.md` and `docs/AI_HANDOFF.md` map the current product, architecture,
  permissions, measurement contracts, safe local setup, file ownership, tests,
  deployment, and physical validation limits. `CLAUDE.md` continues to import the
  same project instructions. The isolated runner now also supports `dev`.

## Verification and evidence boundaries

The changes use the declared Node 22.22+ runtime and the isolated local SQLite
verification database. Production builds and TypeScript checks pass. The unit suite
includes five camera acquisition ownership tests: successful grant, timeout with
late grant, cancellation with late grant, cancellation before requesting hardware,
and permission denial with deadline cleanup.

`tests/e2e/video-workspace.spec.ts` checks full viewport use, desktop/phone/landscape
controls, permission cancellation/retry, denial/manual fallback, stable stream IDs,
and axe accessibility. It also checks every dock button's bounds and 44px minimum
target, including an extra-call-control DOM fixture matching the action shown after
joining a room. That fixture verifies layout, not an external LiveKit connection.

The existing trainee resize test checks Picture in picture, Balanced, Coach focus,
minimizing/restoring, all floating positions, overlay alignment and node preservation
across phones, laptops and TVs. Gallery coverage now includes 1, 4, 12, 36 and 48
synthetic trainees; 48 verifies paging beyond the 36-person overview. Real WASM/GPU
recovery remains separate from synthetic landmark/counting tests. Final regression
results and the exact tested revision are recorded in the pull request.

Screenshots, traces and measurement reports remain local and ignored. No production
accounts, recordings or credentials are needed by these tests. This release makes
no new physical rep-accuracy, device-matrix or 36-device soak-test claim. Those gates
still require consented participants and actual hardware.
