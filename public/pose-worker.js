self.exports = {};
importScripts('/vision/vision_bundle.js');
const { FilesetResolver, PoseLandmarker } = self.exports;
let model;
let variant = 'full';
let delegate = 'CPU';
let files;
let cpuOptions;
let fallbackUsed = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      files = await FilesetResolver.forVisionTasks('/wasm');
      variant = ['lite', 'full', 'heavy'].includes(data.variant) ? data.variant : 'full';
      const options = {
        baseOptions: { modelAssetPath: `/models/pose_landmarker_${variant}.task`, delegate: 'CPU' },
        runningMode: 'VIDEO',
        // One camera represents one trainee. This enables MediaPipe's native
        // temporal smoothing and avoids running its body detector on every frame.
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      cpuOptions = options;
      if (!data.cpuOnly && typeof OffscreenCanvas !== 'undefined') {
        try {
          model = await PoseLandmarker.createFromOptions(files, {
            ...options,
            canvas: new OffscreenCanvas(256, 256),
            baseOptions: { ...options.baseOptions, delegate: 'GPU' },
          });
          delegate = 'GPU';
        } catch {
          model = await PoseLandmarker.createFromOptions(files, options);
          delegate = 'CPU';
        }
      } else {
        model = await PoseLandmarker.createFromOptions(files, options);
        delegate = 'CPU';
      }
      self.postMessage({ type: 'ready', variant, delegate });
    } catch (error) {
      console.error('Pose worker initialization:', error?.message);
      self.postMessage({
        type: 'error',
        message: 'The pose model could not load. Check your connection and retry.',
      });
    }
  }
  if (data.type === 'frame') {
    let transferred = false;
    try {
      if (!model) return;
      const started = performance.now();
      let result;
      try {
        result = model.detectForVideo(data.bitmap, data.timestamp);
      } catch (error) {
        if (delegate !== 'GPU' || fallbackUsed) throw error;
        fallbackUsed = true;
        try {
          model.close();
        } catch {
          /* A lost GPU context may already be closed. */
        }
        model = await PoseLandmarker.createFromOptions(files, cpuOptions);
        delegate = 'CPU';
        self.postMessage({ type: 'backend', variant, delegate });
        result = model.detectForVideo(data.bitmap, data.timestamp);
      }
      const message = {
        type: 'result',
        poses: result.landmarks,
        worldPoses: result.worldLandmarks,
        inferenceMs: performance.now() - started,
        timestamp: data.timestamp,
        mediaTimeMs: data.mediaTimeMs,
        width: data.width,
        height: data.height,
        bitmap: data.presentFrame ? data.bitmap : undefined,
      };
      self.postMessage(message, data.presentFrame ? [data.bitmap] : []);
      transferred = Boolean(data.presentFrame);
    } catch {
      self.postMessage({
        type: 'error',
        message: 'Camera analysis failed. Stop and retry tracking.',
      });
    } finally {
      // Ownership moves back to the renderer only after a successful transfer.
      if (!transferred) data.bitmap?.close();
    }
  }
};
