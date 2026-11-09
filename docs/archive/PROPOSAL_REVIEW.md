# Review of the proposed camera coaching implementation

Reviewed 6 October 2026 against the current source and primary model documentation.

## Decision

Retain the current MediaPipe implementation. The proposal describes a useful starting architecture that is already present in Geez Squad. Replacing the current engine with the simpler example would discard implemented tracking gates, camera lifecycle handling, and counting safeguards. This is an architectural recommendation, not evidence that the current scores or thresholds are validated or optimal.

| Proposal | Current implementation | Decision |
| --- | --- | --- |
| Detect body landmarks from a live camera | Pinned MediaPipe Pose Landmarker Lite; 33 landmarks; local worker; webcam/mobile-facing camera; one frame in flight; inference capped at 10 samples/second | Already present. Keep the model; benchmark alternatives before switching. |
| Squat and push-up angle/phase logic | Aspect-corrected knee/elbow angles; start → working phase → return to start; squat trunk cue and push-up shoulder/hip/ankle alignment cue; coach-selected exercise | Already present. Automatic exercise classification is a separate unimplemented feature; the exercise is selected from the plan. |
| Avoid false reps | Smoothed geometry; stable phase for 180 ms; at least 800 ms in the working stage and between counted reps; no count when starting at the bottom; tracking loss/pause/frame gap resets partial reps | Current safeguards are more extensive than the proposal. Keep them. |
| Overlay, reps, simple form feedback | Skeleton overlay, rep/hold tally, movement phase, confidence, bounded form estimate, corrective cue, optional spoken cues | Already present. Optional completion beep/tick would be a small usability addition; not currently shipped. Retain confidence/uncertainty rather than collapsing feedback into a binary perfect/bad label. |

## Model options are not interchangeable

MediaPipe's model estimates 33 landmarks and is designed for on-device fitness use. [Google Pose Landmarker documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).

MoveNet detects 17 body keypoints. It would need a different landmark adapter and a measured accuracy/performance comparison before replacing MediaPipe. [TensorFlow MoveNet documentation](https://www.tensorflow.org/hub/tutorials/movenet).

OpenPose supports 15, 18, or 25 body/foot keypoint layouts, with additional hand/face models. Its official repository distinguishes free noncommercial use from commercial licensing. It is not a drop-in browser replacement for this 33-landmark implementation. [OpenPose repository and license information](https://github.com/CMU-Perceptual-Computing-Lab/openpose).

## Threshold comparison

| Exercise | Proposed working/top thresholds | Current working/top thresholds |
| --- | --- | --- |
| Squat knee angle | Below 70° / above 160° | At or below 112° / at or above 157° |
| Push-up elbow angle | Below 80° / above 160° | At or below 105° / at or above 150° |

All of these values are heuristics. Neither set has been validated against representative real exercise videos in this session. A lower working threshold demands a larger observed range and changes which movements count; that is not automatically an accuracy improvement. Do not silently replace thresholds or encourage someone to move farther just to trigger a rep.

The next accuracy improvement should be a coach-reviewed dataset with different bodies, camera angles, light, clothing, devices, and exercise variations. Measure rep error, false positives, missed reps, cue precision, rejection rate, and subgroup performance, then version changes. A future coach-calibrated range should be bounded and validated; it is not included in this release. Two-dimensional visible geometry still cannot establish that a movement is perfect or safe.

## Production recommendation

Keep this architecture and complete real PostgreSQL, LiveKit Cloud, delivered-email, and device verification. Those integrations are the immediate launch dependency. Existing automated local checks are documented in VERIFICATION.md. They do not validate physical movement accuracy, provider behavior, or public launch readiness.

Source evidence: `public/pose-worker.js`, `src/lib/pose-engine.ts`, `src/components/camera-analyzer.tsx`, and `tests/pose-engine.test.ts`.
