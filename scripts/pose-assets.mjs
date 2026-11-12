import { createHash } from 'node:crypto';

/** SHA-256 of each pinned MediaPipe pose model (float16, version 1). */
export const POSE_MODELS = {
  lite: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  full: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  heavy: '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b',
};

export const POSE_MODEL_SOURCE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

export const poseModelFile = (variant) => `pose_landmarker_${variant}.task`;

/**
 * Content-addressed version for the served pose assets: the MediaPipe package version (WASM and
 * vision bundle) plus a digest of the pinned model checksums. Any asset change yields a new URL,
 * which is what makes the long-lived immutable cache header and the service worker cache safe.
 */
export function poseAssetVersion(mediapipeVersion, models = POSE_MODELS) {
  if (!/^\d+\.\d+\.\d+$/.test(mediapipeVersion ?? ''))
    throw new Error('A pinned MediaPipe version (x.y.z) is required.');
  const digest = createHash('sha256')
    .update(
      Object.entries(models)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([variant, hash]) => `${variant}:${hash}`)
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 10);
  return `mp${mediapipeVersion}-${digest}`;
}

export const poseAssetBase = (mediapipeVersion) =>
  `/pose-assets/${poseAssetVersion(mediapipeVersion)}`;

/** Candidate download URLs, mirror first. A mirror must serve byte-identical files. */
export function poseModelUrls(variant, mirror = '') {
  const name = poseModelFile(variant);
  const urls = [];
  if (mirror) {
    const base = new URL(mirror.endsWith('/') ? mirror : `${mirror}/`);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(local && base.protocol === 'http:'))
      throw new Error('POSE_MODEL_MIRROR_URL must use https (http only for localhost).');
    urls.push(new URL(name, base).href);
  }
  urls.push(`${POSE_MODEL_SOURCE}/pose_landmarker_${variant}/float16/1/${name}`);
  return urls;
}

/** Exponential backoff with a cap: 1 s, 2 s, 4 s, 8 s ... */
export const retryDelayMs = (attempt, base = 1000, cap = 15000) =>
  Math.min(cap, base * 2 ** attempt);
