import type { PoseLandmarker } from '@mediapipe/tasks-vision';

export type PoseFrame = ImageBitmap | HTMLCanvasElement;
export type PoseModel = 'lite' | 'full' | 'heavy';
type Request =
  | { type: 'init'; variant: PoseModel; cpuOnly: boolean }
  | {
      type: 'frame';
      bitmap: PoseFrame;
      timestamp: number;
      mediaTimeMs: number;
      width: number;
      height: number;
      presentFrame: boolean;
    };

export function appleTouchBrowser() {
  return (
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  );
}

export function initialPoseModel(): PoseModel {
  // Avoid allocating Heavy plus multiple full-resolution frame copies on iOS.
  return appleTouchBrowser() ? 'full' : 'heavy';
}

export function closePoseFrame(frame?: PoseFrame) {
  if (frame && 'close' in frame) frame.close();
}

/** One immutable observed frame until inference/rendering finishes; never a live-video overlay. */
export function captureCanvasFrame(video: HTMLVideoElement, snapshot: HTMLCanvasElement) {
  const width = video.videoWidth,
    height = video.videoHeight;
  if (!width || !height) throw new Error('Waiting for camera frames.');
  const scale = Math.min(1, 960 / Math.max(width, height));
  const targetWidth = Math.round(width * scale),
    targetHeight = Math.round(height * scale);
  if (snapshot.width !== targetWidth) snapshot.width = targetWidth;
  if (snapshot.height !== targetHeight) snapshot.height = targetHeight;
  const context = snapshot.getContext('2d');
  if (!context) throw new Error('Camera frame capture is unavailable.');
  context.drawImage(video, 0, 0, targetWidth, targetHeight);
  return snapshot;
}

/**
 * Safari compatibility path. Explicit HTML canvas avoids worker OffscreenCanvas /
 * video ImageBitmap failures. Loaded only when used; inference stays on device.
 * The caller allows one frame in flight and adapts Full → Lite to its frame budget.
 */
export class BrowserPoseTask {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private disposed = false;
  private model?: PoseLandmarker;
  private canvas?: HTMLCanvasElement;
  private frameTimer?: ReturnType<typeof setTimeout>;
  private pendingFrame?: PoseFrame;
  private variant: PoseModel = 'full';
  private delegate: 'CPU' | 'GPU' = 'GPU';
  private fallbackUsed = false;

  private emit(data: object) {
    if (!this.disposed) this.onmessage?.(new MessageEvent('message', { data }));
  }

  postMessage(data: Request, _transfer?: Transferable[]) {
    if (this.disposed) {
      if (data.type === 'frame') closePoseFrame(data.bitmap);
      return;
    }
    if (data.type === 'init') {
      this.variant = data.variant;
      void this.load(data.cpuOnly)
        .then(() => this.emit({ type: 'ready', variant: this.variant, delegate: this.delegate }))
        .catch(() => {
          this.emit({
            type: 'error',
            message:
              'Pose tracking could not start. Check your connection, update iOS if needed, and retry. Manual tracking is available.',
          });
        });
      return;
    }
    // Yield to input/paint between synchronous MediaPipe calls.
    this.pendingFrame = data.bitmap;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = undefined;
      this.pendingFrame = undefined;
      void this.detect(data);
    }, 0);
  }

  private async load(cpuOnly: boolean) {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/wasm');
    if (this.disposed) return;
    const create = async (delegate: 'GPU' | 'CPU') => {
      if (this.canvas) {
        this.canvas.width = 0;
        this.canvas.height = 0;
      }
      this.canvas = document.createElement('canvas');
      const model = await PoseLandmarker.createFromOptions(files, {
        canvas: this.canvas,
        baseOptions: { modelAssetPath: `/models/pose_landmarker_${this.variant}.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (this.disposed) {
        model.close();
        this.canvas.width = 0;
        this.canvas.height = 0;
        return;
      }
      this.model = model;
      this.delegate = delegate;
    };
    if (!cpuOnly) {
      try {
        await create('GPU');
        return;
      } catch {
        if (this.disposed) return;
      }
    }
    await create('CPU');
  }

  private async detect(data: Extract<Request, { type: 'frame' }>) {
    if (this.disposed || !this.model) {
      closePoseFrame(data.bitmap);
      return;
    }
    const started = performance.now();
    try {
      let result;
      try {
        result = this.model.detectForVideo(data.bitmap, data.timestamp);
      } catch (error) {
        if (this.delegate !== 'GPU' || this.fallbackUsed) throw error;
        this.fallbackUsed = true;
        this.model.close();
        this.model = undefined;
        await this.load(true);
        const recovered = this.model as PoseLandmarker | undefined;
        if (this.disposed || !recovered) {
          closePoseFrame(data.bitmap);
          return;
        }
        this.emit({ type: 'backend', variant: this.variant, delegate: this.delegate });
        result = recovered.detectForVideo(data.bitmap, data.timestamp);
      }
      this.emit({
        type: 'result',
        poses: result.landmarks,
        worldPoses: result.worldLandmarks,
        inferenceMs: performance.now() - started,
        timestamp: data.timestamp,
        mediaTimeMs: data.mediaTimeMs,
        width: data.width,
        height: data.height,
        bitmap: data.bitmap,
      });
    } catch {
      closePoseFrame(data.bitmap);
      this.emit({
        type: 'error',
        message: 'Camera analysis stopped. Retry tracking or use manual tracking.',
      });
    }
  }

  terminate() {
    this.disposed = true;
    this.onmessage = null;
    this.onerror = null;
    if (this.frameTimer !== undefined) clearTimeout(this.frameTimer);
    closePoseFrame(this.pendingFrame);
    this.pendingFrame = undefined;
    try {
      this.model?.close();
    } catch {
      /* A lost context may already be closed. */
    }
    this.model = undefined;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
  }
}
