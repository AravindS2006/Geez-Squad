/**
 * Versioned URL prefix for the MediaPipe vision bundle, WASM and pose models. The segment after
 * /pose-assets/ is content-addressed (MediaPipe version plus a digest of the pinned model
 * checksums, scripts/pose-assets.mjs), so these files are served with an immutable cache header.
 * scripts/prepare-assets.mjs fails the build when this value, public/pose-worker.js or
 * public/sw.js disagree with the installed assets.
 */
export const POSE_ASSET_BASE = '/pose-assets/mp0.10.35-27563efb7a';
