import { mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  POSE_MODELS,
  poseAssetBase,
  poseAssetVersion,
  poseModelFile,
  poseModelUrls,
  retryDelayMs,
} from './pose-assets.mjs';

const root = new URL('../', import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function hashOf(file) {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

const { version: mediapipeVersion } = JSON.parse(
  await readFile(new URL('node_modules/@mediapipe/tasks-vision/package.json', root), 'utf8'),
);
const version = poseAssetVersion(mediapipeVersion);
const base = poseAssetBase(mediapipeVersion);

// The served URL must match what the app, the pose worker and the service worker request.
for (const file of ['src/lib/pose-assets.ts', 'public/pose-worker.js', 'public/sw.js']) {
  if (!(await readFile(new URL(file, root), 'utf8')).includes(`'${base}'`))
    throw new Error(
      `${file} must reference '${base}'. Update the pose asset base there after changing MediaPipe or a model.`,
    );
}

// Versioned output: public/pose-assets/<version>/{vision,wasm,models}. Older versions this script
// produced are removed so a deploy ships one copy.
const assetsRoot = new URL('public/pose-assets/', root);
await mkdir(assetsRoot, { recursive: true });
for (const entry of await readdir(assetsRoot))
  if (entry !== version) await rm(new URL(entry, assetsRoot), { recursive: true, force: true });
const out = new URL(`${version}/`, assetsRoot);
for (const dir of ['wasm/', 'models/', 'vision/'])
  await mkdir(new URL(dir, out), { recursive: true });

await copyFile(
  new URL('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs', root),
  new URL('vision/vision_bundle.js', out),
);
for (const name of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  await copyFile(
    new URL(`node_modules/@mediapipe/tasks-vision/wasm/${name}`, root),
    new URL(`wasm/${name}`, out),
  );
}

// Models: reuse the served copy, then the build cache, then download (mirror first) with retries.
// Every source is accepted only when its SHA-256 matches the pinned value.
const cacheDir = pathToFileURL(
  resolve(
    fileURLToPath(root),
    process.env.POSE_MODEL_CACHE_DIR || 'node_modules/.cache/geez-pose-models',
  ) + sep,
);
await mkdir(cacheDir, { recursive: true });
const attempts = Math.max(1, Number(process.env.POSE_MODEL_DOWNLOAD_ATTEMPTS) || 4);

async function download(variant, expectedHash) {
  const failures = [];
  for (const url of poseModelUrls(variant, process.env.POSE_MODEL_MIRROR_URL)) {
    const host = new URL(url).host;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        // A wrong checksum is not transient: do not retry the same source.
        if (sha256(bytes) !== expectedHash) {
          failures.push(`${host}: checksum mismatch`);
          break;
        }
        return bytes;
      } catch (error) {
        failures.push(`${host} attempt ${attempt + 1}: ${error.message}`);
        if (attempt + 1 < attempts) await sleep(retryDelayMs(attempt));
      }
    }
  }
  throw new Error(`${variant} model download failed (${failures.join('; ')}).`);
}

for (const [variant, expectedHash] of Object.entries(POSE_MODELS)) {
  const name = poseModelFile(variant);
  const target = new URL(`models/${name}`, out);
  const cached = new URL(name, cacheDir);
  if ((await hashOf(target)) === expectedHash) {
    if ((await hashOf(cached)) !== expectedHash) await copyFile(target, cached);
    continue;
  }
  if ((await hashOf(cached)) !== expectedHash) {
    await writeFile(cached, await download(variant, expectedHash));
    console.log(`Downloaded and verified the ${variant} pose model.`);
  }
  await copyFile(cached, target);
  if ((await hashOf(target)) !== expectedHash)
    throw new Error(`${variant} model checksum mismatch after copy.`);
}
await writeFile(
  new URL('models/checksum.txt', out),
  JSON.stringify({ version, models: POSE_MODELS }, null, 2) + '\n',
);
console.log(`Pose model and WASM assets are ready at public${base}.`);
