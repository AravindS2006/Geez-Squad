# Pose reliability corrections — 13 October 2026

## What this addresses

The reported failure was front-facing biceps curls on phones and desktops: some repetitions were missed and form estimates were wrong. This review traced camera capture, worker inference, landmark continuity, joint stability, image/world geometry, exercise profiles, movement filtering, calibration, the repetition state machine, countdown, displayed scores, and saved training metrics. The existing twelve exercise profiles and their negative cases were reviewed rather than treating curls as an isolated counter.

The changes use rule version `profile-v7`. They correct reproducible algorithm defects; they are not a claim that every person's movement is now measured accurately. We do not have an annotated recording of the reported physical-camera session. The precise contribution of landmark/model error to that session is therefore still unknown.

## Findings and fixes

| Finding | Why it mattered | Correction |
| --- | --- | --- |
| Counting used estimated 3D, but curl form used only unsigned screen slopes | An upper arm raised toward the camera could receive 95/100; rotating the camera could incorrectly reduce the score | Compare the shoulder-to-elbow vector with the shoulder-to-hip vector in the accepted geometry. Use trustworthy depth when available, and retain 2D fallback when appropriate. |
| Absolute torso inclination confused fixed camera tilt with movement | A stationary, tilted camera could produce a correction; changing torso posture was not measured against a starting reference | Capture a torso orientation reference, preserve it from countdown into the set, and compare subsequent orientation. Smooth supported alignment scores to reduce frame noise. |
| Exact endpoints could erase near-threshold complete cycles | A 145°/85° range could miss repeated 143°/88° observations despite sufficient excursion and duration | Require the initial start position, then apply the profile's existing six-degree hysteresis band to return and end observations. Keep minimum ROM, duration, approach, occlusion, side/source, and cooldown checks. |
| Duplicate timestamps reset motion and body association | One repeated delivery could discard a valid in-flight rep | Ignore stale deliveries without clearing the last reliable identity or the movement cycle. Invalid timestamps and real tracking gaps still have separate handling. |
| Calibration saved angles but discarded measurement identity | Calibrated left-arm 2D thresholds could later be applied to the right arm or a 3D angle | Persist the calibrated side and geometry with the thresholds. A calibrated depth range suspends when depth is unavailable; a calibrated 2D range stays 2D. Recalibration/manual geometry edits release the old binding. |
| Calibration required at least 33° for every exercise | Valid shorter hip excursions could never complete calibration despite fitting the configuration's 25° minimum gap | Use a bounded adaptive endpoint inset while preserving the minimum separation. Stable 31° excursions now calibrate; small partial movement still fails. |
| Hold readiness hard-coded 155°/160° and required a separate score threshold | A valid configured hold could start and then lose countdown readiness, or accept an incompatible initial threshold | Initial and continuing hold readiness use the configured threshold and actual holding phase. Recognized exercise posture is separate from its quality estimate; a low score cannot silently override an accepted hold range. |
| Some scores were effectively fabricated constants | Bridge/crunch returned 90; row was almost always 95 despite no adequate technique measurement | Those profiles retain posture recognition, counting, range, and tempo, but return null for numeric form/rep quality. Readiness recognizes valid posture without requiring a fabricated score. The UI explains missing estimates. |
| Range and tempo aggregation depended on a quality score existing | Removing unsupported scores would otherwise erase valid movement measurements | Track completed-rep measurements separately from scored-rep samples. Unknown quality stays unknown. |
| Finished-set UI averaged frames while saved history weighted time | Changing inference cadence could give a different displayed result from the saved result | Use the same observed-time-weighted summary for the completed-set UI and durable record. |
| An extended elbow alone could satisfy an overhead press endpoint | A horizontal press at shoulder height could look like a completed shoulder press | Require an observed overhead wrist position at the press endpoint. |
| Diagnostics dropped intermediate frames if phase/count did not change | A short missed extremum could disappear from the exported evidence | Opt-in diagnostics retain every analyzed frame, bounded to 600 frames or one minute, including calibration geometry. No images/audio or automatic upload were added. |

Geometry and form evaluation now live in `src/lib/pose-geometry.ts` and `src/lib/pose-form.ts`. `src/lib/pose-engine.ts` retains tracking and cycle state. This separates what can be measured from how a repetition is accepted, making the contracts easier to review and test.

## Counting and scoring contracts

A rep still requires an observed start, movement away, sufficient endpoint/approach evidence, and return. The tolerance band does not infer unseen repetitions or remove the minimum range. New tests specifically reject partial curls with 98°, 115°, and 139° minima. Existing tests continue to reject isolated wrist spikes, endpoint oscillation, impossible speed, prolonged loss, unseen return motion, wrong posture, and switching sides/sources mid-cycle.

Curl form now estimates visible upper-arm alignment and torso-orientation change. It does not measure load, effort, wrist mechanics, muscle activation, pain, or all aspects of technique. A high score is not proof that an exercise is safe or ideal. Other supported numeric scores remain limited alignment heuristics. Bridge, crunch, and row now show a dash for unsupported scoring instead of a reassuring constant.

Depth is inferred by a monocular model. Landmark visibility is not a calibrated probability that the depth angle is correct. The existing finite-coordinate, segment-length, visibility, source-lock, and continuity checks reduce obvious bad measurements but cannot eliminate plausible model errors.

The system still requires one trainee in view. `numPoses: 1` does not establish that no second person is present. Side-view exercises retain their camera-position requirements; this patch does not claim all exercises are valid from arbitrary viewpoints.

The user selects an exercise profile; the system is not a trained general exercise classifier. A similar joint trajectory from a different action can still fool a heuristic recognizer. Distinguishing all exercise variations requires labeled positive and negative human examples, not just another global angle threshold.

## Verification

Nine cases in the first new regression batch failed against the prior implementation, including missed near-threshold curls at 8/12/20/30 FPS, depth-related form errors, camera roll, duplicate delivery, hold readiness, and short-range calibration. They pass after correction.

The new front-camera fixture projects constant-length articulated 3D arms into both portrait and landscape images. The near-threshold tests traverse continuity, joint stability, and the actual rep engine rather than testing only angle math. The suite also checks torso movement, partial-rep rejection, calibration source retention, and persistence of range/tempo without numeric quality.

The complete unit suite passes **314 cases across 24 files**, including the existing twelve-profile and worker regressions. The optimized production build, TypeScript compilation, formatting, and **175 local API checks** pass. The API checks use an isolated SQLite database and disposable accounts, with real email, billing, and video-service credentials disabled.

Local verification used Windows, installed Edge, and Node 22.14.0. The repository declares Node 22.22+; deployment/CI acceptance should also run on that supported runtime.

The initial ten focused browser checks passed. A final run additionally covers real pinned model loading and GPU/CPU recovery, camera rotation during capture, marker sizing, and failed-save recovery through database persistence and reload. Its result is recorded below when complete.

## Research and design decisions

- Google's [Pose Landmarker web documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) distinguishes image coordinates from world coordinates and documents synchronous inference. The worker and aspect-correct image geometry remain appropriate. Using one accepted geometry for a measurement is an engineering requirement; world output does not itself validate form scoring.
- Google's [pose classification guidance](https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses) describes pose normalization, multiple viewpoints, representative training examples, and the view dependence of 2D angles. This supports body-relative curl geometry and explicit view constraints. A new learned classifier without representative labeled data would not be an evidence-based replacement.
- MediaPipe's [repetition-counting example](https://chuoling.github.io/mediapipe/solutions/pose_classification.html) uses distinct thresholds to avoid noisy state changes. The revised endpoint band applies that principle to this application's observed-angle state machine. Six degrees is an existing engineering tolerance, not a published universal exercise threshold.
- The [One Euro filter authors' guidance](https://gery.casiez.net/1euro/) explains the jitter/lag tradeoff and why tuning depends on signal units. Movement filtering remains separate from presentation and alignment-score smoothing; stacking aggressive filters over the rep signal would risk losing short extrema.

## Remaining acceptance work

Run repeated physical-camera trials on both phone and desktop with manually counted repetitions and coach-rated visible faults. Cover left/right arms, alternating curls, ordinary camera tilt, depth motion, loose clothing, different body proportions, lighting, partial framing, frame-rate changes, and longer sessions. Compare false/missed counts and correction errors, not only average scores. Use the opt-in tracking report immediately after a failure to retain the actual landmark sequence; it is local and contains movement coordinates, so sharing it remains the user's choice.

No deployment or production configuration change is included. Historical v6 records keep their original version; new sets record v7. Comparing numerical scores across versions as if they were identical measurements would be misleading.
