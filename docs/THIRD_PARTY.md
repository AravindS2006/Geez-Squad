# Dependency and model provenance

Framework: Next.js 16.3.8 and React 19.3.0. Authentication: Better Auth 1.7.7. ORM: Prisma 6.19.3. Video: LiveKit browser/server SDKs. Icons: Lucide. Billing: Stripe SDK. Full resolved dependency versions are in package-lock.json.

MediaPipe Tasks Vision is pinned to 0.10.35 (Apache-2.0 package). The app uses Google's Pose Landmarker float16 model bundles, version 1. Full is the default, Heavy is selectable for faster devices, and Lite is selectable for performance. Official model details and license are documented in Google's [BlazePose GHUM model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf).

| Variant | Versioned source | SHA-256 |
| --- | --- | --- |
| Lite | [pose_landmarker_lite.task](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Full | [pose_landmarker_full.task](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task) | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| Heavy | [pose_landmarker_heavy.task](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task) | `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` |

The setup/build script copies the installed pinned CJS vision bundle as a classic worker script and copies both SIMD/non-SIMD WASM assets. Classic workers are required by this version's WASM script-loading path; no main-thread inference fallback is used. GPU inference uses an OffscreenCanvas when available and falls back to CPU initialization. Assets are generated locally and ignored in source control. Production builds reproduce them and verify all three model checksums, including existing cached files. The app does not download arbitrary `latest` models at runtime.

The adaptive filter implementation follows the speed-dependent cutoff described by Casiez, Roussel, and Vogel in [1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems](https://gery.casiez.net/1euro/), CHI 2012. The app's filter, exercise profiles, geometric checks, and state machine are application source code rather than a trained exercise-classification model. See [research notes](pose-research-notes.md) for the model comparison and selection rationale.

The npm audit initially identified a deepmerge-ts build-tool advisory inherited through Prisma config. An explicit deepmerge-ts 8 override resolves it; database generation and production builds were checked with that override. Re-evaluate/remove the override when a supported Prisma release incorporates the fix. `.npmrc` records legacy peer resolution because the workstation's npm 10.9.2 resolver crashed while exploring optional Vitest peers; the committed lockfile fixes the resolved graph. Avoid blind force-upgrades.
