import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// MediaPipe's public Apache 2.0 test asset, not a participant/camera recording.
// Source and license: mediapipe/tasks/testdata/vision/BUILD in google-ai-edge/mediapipe.
const digest = 'c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b';
export async function addPublicPoseCamera(page: Page) {
  const path = 'test-results/public-fixtures/pose.jpg';
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    const response = await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg', {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('Public pose fixture download failed.');
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== digest)
      throw new Error('Public pose fixture checksum mismatch.');
    await mkdir('test-results/public-fixtures', { recursive: true });
    await writeFile(path, bytes);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== digest)
    throw new Error('Public pose fixture checksum mismatch.');
  await page.route('**/__tests__/pose.jpg', (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: bytes }),
  );
  await page.addInitScript(() => {
    const state = window as unknown as { drawnPoseJoints: number; testCameraStopped: boolean };
    state.drawnPoseJoints = 0;
    state.testCameraStopped = false;
    const image = new Image();
    image.src = '/__tests__/pose.jpg';
    const streams = new WeakMap<HTMLVideoElement, unknown>();
    const playing = new WeakMap<HTMLVideoElement, boolean>();
    const track = {
      readyState: 'live',
      stop() {
        this.readyState = 'ended';
        state.testCameraStopped = true;
      },
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          await image.decode();
          track.readyState = 'live';
          state.testCameraStopped = false;
          return { getTracks: () => [track], getVideoTracks: () => [track] };
        },
      },
    });
    const prototype = HTMLVideoElement.prototype;
    Object.defineProperty(prototype, 'srcObject', {
      configurable: true,
      get() {
        return streams.get(this) ?? null;
      },
      set(value) {
        if (value) streams.set(this, value);
        else streams.delete(this);
      },
    });
    Object.defineProperty(prototype, 'readyState', {
      configurable: true,
      get() {
        return streams.has(this) ? 4 : 0;
      },
    });
    Object.defineProperty(prototype, 'videoWidth', {
      configurable: true,
      get() {
        return image.naturalWidth;
      },
    });
    Object.defineProperty(prototype, 'videoHeight', {
      configurable: true,
      get() {
        return image.naturalHeight;
      },
    });
    Object.defineProperty(prototype, 'currentTime', {
      configurable: true,
      get() {
        return performance.now() / 1000;
      },
    });
    Object.defineProperty(prototype, 'paused', {
      configurable: true,
      get() {
        return !playing.get(this);
      },
    });
    prototype.play = function () {
      playing.set(this, true);
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    prototype.pause = function () {
      playing.set(this, false);
      this.dispatchEvent(new Event('pause'));
    };
    prototype.requestVideoFrameCallback = () => 1;
    prototype.cancelVideoFrameCallback = () => {};
    // Windows WebKit has no WebRTC devices; substitute only the decoded camera
    // source. Canvas pixels, WebGL, WASM, model, pose engine and overlay remain real.
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      source,
      ...args: unknown[]
    ) {
      return (draw as (...args: unknown[]) => void).call(
        this,
        source instanceof HTMLVideoElement && streams.has(source) ? image : source,
        ...args,
      );
    } as typeof draw;
    const arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      if (this.canvas.classList.contains('pose-canvas')) state.drawnPoseJoints++;
      return arc.apply(this, args);
    };
  });
}
