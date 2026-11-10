# iPhone pose compatibility — 24 October 2026

Reported device: iPhone 16, latest iOS; camera opens but no skeleton or counts.
The exact physical-device failure has not been captured in a Safari remote debugger.
This update addresses reproduced pipeline failure modes rather than claiming that
every iPhone condition has been validated.

## Reproduced gaps and repair

- A video-frame callback API can exist without delivering callbacks. The previous
  loop then never sampled any frames. A timer now backs up those callbacks, with
  the same video-time, visibility and single-in-flight guards. Repeated or hidden
  frames cannot create movement evidence.
- Rejected video `createImageBitmap()` calls were silently discarded forever.
  Repeated capture failures now switch to canvas-based compatibility tracking.
  Worker initialization/error/stall recovery can also use that path. Persistent
  capture failures become visible and manual tracking remains available.
- iPhone/iPad uses local MediaPipe inference with an explicit HTML canvas and
  captured canvas pixels, avoiding worker graphics and transferable video bitmaps.
  The library is loaded lazily. Normal supported browsers retain worker inference.
  Worker graphics are probed with an actual WebGL2 context, not constructor presence.
- Apple touch devices start Full instead of allocating Heavy by default. Snapshots
  preserve aspect ratio and cap the long edge at 960px. Sustained slow inference
  can select Lite; GPU failures can recover on CPU. Completed counts are retained
  and readiness is reacquired after backend changes.
- Inference receives one frozen observed image, and the same image is rendered with
  its landmarks. The compatibility loop yields between synchronous model calls;
  it can still occupy the main thread during each call. This is a compatibility
  tradeoff, not a claim of identical device performance.
- Muted inline playback is explicit. If Safari pauses playback or a foreground
  return needs user activation, Resume camera keeps the existing stream and model.
- Manual practice uses explicit dark backgrounds and readable text/button colors;
  the new WebKit accessibility journey exposed inherited light backgrounds.
- The iOS install suggestion no longer covers header/navigation actions. It moves
  above the bottom navigation on phones, hides during modal dialogs, and can be
  dismissed for the current browser session. A WebKit regression checks real
  pointer access to Close navigation, persistence of dismissal, login and the
  core studio/workspace views without horizontal overflow.

## Regression evidence

`pose-browser.test.ts` verifies late-model cleanup, GPU/CPU recovery, snapshot and
timestamp identity, pending-frame cleanup and the Apple-device model default.
`iphone-compatibility.spec.ts` exercises missing frame callbacks through a completed
deterministic repetition, playback pause/resume and real-model capture fallback.
Existing real WASM, GPU recovery and capture/rotation cases remain required.

`playwright.webkit.config.ts` runs the actual WebKit engine with a phone viewport.
The Windows WebKit distribution has no WebRTC camera devices, so its model test
substitutes only decoded source pixels and video metadata. WebGL, WASM, MediaPipe,
geometry and skeleton rendering remain real. It disables worker graphics and
video-bitmap capture and requires actual drawn landmarks. A separate journey checks
manual tracking, mobile controls and axe accessibility. CI runs both Edge and WebKit.

The synthetic camera image is the MediaPipe Authors' public `pose.jpg` test asset,
declared under Apache 2.0 in their
[test-data BUILD file](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/testdata/vision/BUILD).
It is fetched from `https://storage.googleapis.com/mediapipe-assets/pose.jpg`, verified
against SHA-256 `c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b`,
and kept in ignored local test storage. It is not a participant recording and is
not shipped as an application asset. Tests do not upload camera images or traces.

Physical iPhone 16 Safari and installed-PWA checks remain necessary: first camera
grant, sustained counting, landscape rotation, lock/background/return, camera
switching and live-class audio/video under load. Desktop WebKit emulation does not
prove those physical camera, thermal or OS lifecycle behaviors. Automatic workout
capabilities remain beta until the established accuracy gates pass.

## Primary compatibility references

- [MediaPipe web setup](https://developers.google.com/edge/mediapipe/solutions/setup_web)
- [WebKit OffscreenCanvas compatibility](https://bugs.webkit.org/show_bug.cgi?id=183720)
- [WebKit video-frame callback rendering dependency](https://bugs.webkit.org/show_bug.cgi?id=282797)

Backend and analyzed FPS are exposed as DOM diagnostics on the analyzer; these
contain no images/landmarks and are not uploaded as new telemetry.
