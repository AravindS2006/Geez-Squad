// Video-to-count check: decode a local video clip frame by frame, run the real
// MediaPipe pose model on every frame in installed Edge, save the landmarks as a
// local trace, then replay that trace through the production counting engine.
//
// This covers the layer synthetic landmark tests cannot: real model output on a real
// person. It is still not release evidence. Clips from the internet have no consented
// participants, no physical-device capture and no per-rep annotations, so their
// results never feed `pose:evaluate --release-gates`.
//
// Usage: node scripts/pose-clip-check.mjs <manifest.json> [--fps=30] [--model=heavy] [--only=id,id] [--replay-only] [--no-depth] [--strict]
// Manifest: { "clips": [{ "id", "file", "exercise", "expectedReps"?, "expectedHoldMs"?,
//   "config"?: { "side"?, "armMode"? }, "startMs"?, "endMs"?, "source"?, "license"? }] }
// `file` is resolved relative to the manifest. Nothing is uploaded.
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { poseAssetBase } from './pose-assets.mjs';

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, value = 'true'] = arg.slice(2).split('=');
      return [key, value];
    }),
);
const manifestPath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!manifestPath)
  throw new Error(
    'Usage: node scripts/pose-clip-check.mjs <manifest.json> [--fps=30] [--model=heavy] [--only=id,id] [--replay-only]',
  );
const fps = Number(flags.fps ?? 30);
if (!Number.isFinite(fps) || fps < 5 || fps > 60) throw new Error('--fps must be 5 to 60.');
const model = ['lite', 'full', 'heavy'].includes(flags.model) ? flags.model : 'heavy';
const only = flags.only ? new Set(flags.only.split(',')) : null;
const manifestFile = resolve(manifestPath);
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (!Array.isArray(manifest.clips) || !manifest.clips.length)
  throw new Error('The manifest needs a non-empty "clips" array.');
const clips = manifest.clips
  .filter((clip) => !only || only.has(clip.id))
  .map((clip) => {
    if (!/^[\w.-]{1,80}$/.test(clip.id ?? '')) throw new Error(`Invalid clip id: ${clip.id}`);
    const file = resolve(dirname(manifestFile), clip.file);
    if (!existsSync(file)) throw new Error(`Clip file not found: ${file}`);
    return { ...clip, file };
  });
const outputDir = resolve('test-results/pose-clips');
await mkdir(outputDir, { recursive: true });
const tracePath = (clip) => resolve(outputDir, `${clip.id}.${model}.${fps}fps.trace.json`);

const publicDir = resolve('public');
const { version: mediapipeVersion } = JSON.parse(
  await readFile('node_modules/@mediapipe/tasks-vision/package.json', 'utf8'),
);
const assetBase = poseAssetBase(mediapipeVersion);
for (const asset of [
  `${assetBase.slice(1)}/vision/vision_bundle.mjs`,
  `${assetBase.slice(1)}/wasm/vision_wasm_internal.wasm`,
  `${assetBase.slice(1)}/models/pose_landmarker_${model}.task`,
])
  if (!existsSync(resolve(publicDir, asset)))
    throw new Error(`Missing public/${asset}. Run "npm run assets" first.`);

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
};
const page = `<!doctype html><meta charset="utf-8"><video id="clip" muted playsinline preload="auto"></video>
<script type="module">
import { FilesetResolver, PoseLandmarker } from '${assetBase}/vision/vision_bundle.mjs';
const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null);
const points = (poses) => (poses ?? []).slice(0, 2).map((pose) => pose.slice(0, 33).map((p) => ({
  x: round(p.x), y: round(p.y), z: round(p.z), visibility: round(p.visibility), presence: round(p.presence ?? 1),
})));
window.runClip = async ({ url, model, fps, startMs, endMs }) => {
  const files = await FilesetResolver.forVisionTasks('${assetBase}/wasm');
  // Same options as public/pose-worker.js. CPU keeps a headless run reproducible.
  const landmarker = await PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '${assetBase}/models/pose_landmarker_' + model + '.task', delegate: 'CPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  const video = document.getElementById('clip');
  video.src = url;
  await new Promise((done, fail) => {
    video.onloadeddata = done;
    video.onerror = () => fail(new Error('This browser cannot decode the clip.'));
  });
  const duration = video.duration * 1000;
  const from = Math.max(0, startMs ?? 0), to = Math.min(duration - 1, endMs ?? duration);
  const frames = [];
  for (let n = 0; ; n++) {
    const mediaTimeMs = from + (n * 1000) / fps;
    if (mediaTimeMs > to) break;
    await new Promise((done) => {
      video.onseeked = done;
      video.currentTime = mediaTimeMs / 1000;
    });
    const bitmap = await createImageBitmap(video);
    // Engine timestamps start above zero: zero means "no previous frame" there.
    const timestamp = Math.round(1000 + (n * 1000) / fps);
    const started = performance.now();
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const inferenceMs = round(performance.now() - started);
    bitmap.close();
    frames.push({ timestamp, mediaTimeMs: round(mediaTimeMs), inferenceMs,
      poses: points(result.landmarks), worldPoses: points(result.worldLandmarks) });
  }
  landmarker.close();
  return { width: video.videoWidth, height: video.videoHeight, durationMs: round(duration), frames };
};
window.harnessReady = true;
</script>`;

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file;
  if (path === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
    return;
  }
  const clip = /^\/clip\/(\d+)$/.exec(path);
  if (clip) file = clips[Number(clip[1])]?.file;
  else {
    file = resolve(publicDir, `.${path}`);
    if (!file.startsWith(publicDir + sep)) file = undefined;
  }
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const size = statSync(file).size;
  const type = types[extname(file).toLowerCase()] ?? 'application/octet-stream';
  // Seeking a video element needs byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    response.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': size,
  });
  createReadStream(file).pipe(response);
});

if (!flags['replay-only']) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const [index, clip] of clips.entries()) {
      const tab = await browser.newPage();
      tab.on('pageerror', (error) => console.error(`[${clip.id}] page error: ${error.message}`));
      await tab.goto(origin);
      await tab.waitForFunction(() => window.harnessReady === true, null, { timeout: 60000 });
      const started = Date.now();
      const result = await tab.evaluate((input) => window.runClip(input), {
        url: `/clip/${index}`,
        model,
        fps,
        startMs: clip.startMs,
        endMs: clip.endMs,
      });
      await tab.close();
      const config = clip.config ?? {};
      await writeFile(
        tracePath(clip),
        JSON.stringify({
          version: 1,
          createdAt: new Date().toISOString(),
          runtime: '@mediapipe/tasks-vision@0.10.32',
          contents: 'Joint coordinates from a local video clip; no images or audio.',
          clip: { id: clip.id, source: clip.source ?? null, license: clip.license ?? null },
          sampledFps: fps,
          durationMs: result.durationMs,
          frameCount: result.frames.length,
          frames: result.frames.map((frame) => ({
            ...frame,
            exercise: clip.exercise,
            config,
            width: result.width,
            height: result.height,
            model,
            backend: 'CPU',
            mode: 'active',
            stage: '',
            continuity: '',
          })),
        }),
      );
      console.log(
        `[${clip.id}] ${result.frames.length} frames at ${result.width}x${result.height} in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
}

const reportPath = resolve(outputDir, 'report.json');
const replayManifest = resolve(outputDir, 'replay-manifest.json');
await writeFile(
  replayManifest,
  JSON.stringify({
    clips: clips.map((clip) => ({
      id: clip.id,
      exercise: clip.exercise,
      expectedReps: clip.expectedReps ?? null,
      expectedHoldMs: clip.expectedHoldMs ?? null,
      tracePath: tracePath(clip),
    })),
  }),
);
const replay = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/pose-clip-replay.test.ts', '--maxWorkers=1'],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      GEEZ_CLIP_MANIFEST: replayManifest,
      GEEZ_CLIP_REPORT: reportPath,
      GEEZ_CLIP_NO_DEPTH: flags['no-depth'] ? '1' : '',
    },
  },
);
if (replay.status !== 0) process.exit(1);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
console.log(`\nVideo-to-count check (rules ${report.ruleVersion}, ${model} model, ${fps} fps)`);
console.table(
  report.clips.map((clip) => ({
    clip: clip.id,
    exercise: clip.exercise,
    expected: clip.expected,
    counted: clip.counted,
    result: clip.result,
    tracked: `${Math.round(clip.trackedShare * 100)}%`,
    angle: clip.angleRange,
    rejected: clip.rejections,
    'top cue while untracked': clip.topUntrackedCue,
  })),
);
console.log(
  `Report: ${reportPath}\nInternet clips are a smoke check of the model-to-count path, not accuracy or release evidence.`,
);
if (flags.strict && report.clips.some((clip) => clip.result === 'mismatch')) process.exit(2);
