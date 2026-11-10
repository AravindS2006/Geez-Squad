# Coach monitoring and pose stability — local verification

10 October 2026. These changes are verified in the local checkout; this report does not establish that the deployed site has been updated.

## Classroom behavior

- Overview fits up to 36 trainee tiles into the available desktop height. Thirty trainees use six columns and five rows, without scrolling at laptop/desktop sizes. The coach's optional preview floats separately instead of taking a trainee slot.
- Selecting a trainee opens a larger video and private cue panel beside the gallery. Reps/hold time, form, tracking status, raised hands, connection quality, search, and an attention filter support class monitoring. Sending a private cue and clearing a help request were verified against the actual API/database.
- Larger view uses 12 tiles per page. Larger classes paginate; off-page summaries still reach the coach, and raised hands are counted across the roster. Phone/tablet galleries scroll within the meeting while controls stay available. A phone cannot display 30 useful full-body videos simultaneously at desktop scale.
- Trainees receive the coach camera by default and can optionally open classmates in groups of nine. Room audio remains available for unmuted microphones. Screen sharing is limited to the coach's publications.

## Video and device budget

Joining sets `autoSubscribe: false`. Subscription reconciliation runs for join, track publication/removal, mute/unmute, reconnect, page/filter changes, and focus changes. Hidden classmates and off-page coach camera feeds are unsubscribed; the selected trainee stays subscribed while their detail panel is open. LiveKit adaptive streaming still pauses off-screen video, and dynacast avoids publishing unused layers. See [LiveKit's subscription documentation](https://docs.livekit.io/transport/media/subscribe/).

Camera capture uses 720p at up to 24 FPS. Publication offers 180p at up to 120 kbps/12 FPS, 360p at 350 kbps/20 FPS, and 720p at 900 kbps/24 FPS for trainees (1.5 Mbps for the coach). Large coach overviews cap camera subscriptions at the low layer; the selected trainee can receive high quality. This preserves full local camera resolution for pose inference even when the coach receives thumbnails.

Thirty low-layer video feeds have a configured encoding budget of roughly 3.6 Mbps. This is a planning estimate, not measured traffic or a minimum connection specification: audio, retransmissions, protocol overhead, screen sharing, and the selected larger feed add traffic. Each trainee normally decodes one coach camera rather than 30 peer cameras. The coach still decodes the visible gallery, so laptop decode capacity must be tested separately.

## Pose stability

The pinned MediaPipe detector remains in a worker, with frame/landmark synchronization and one inference in flight. Additional behavior:

- Sudden body relocation or scale changes require multiple stable observations before reacquisition, just like contradictory left/right identity. A single body outlier cannot move the whole skeleton to another location.
- Abrupt limb-length explosions are hidden in both image/world scoring inputs and the overlay. Related hand/foot points disappear together. Original diagnostic model output remains intact; old positions are never substituted into current measurements.
- A relocating low-confidence joint disappears until confidence returns. Ordinary visibility hysteresis and movement smoothing remain intact.
- Capture attempts are capped at 20 analyzed frames/sec. Sustained slow Heavy inference switches to Full; sustained slow Full switches to Lite. Completed totals and the existing camera stream survive recovery. Lite can reduce detail; the UI reports the switch.

Tests cover isolated wrist spikes, body relocation/recovery, gradual turns, controlled curl arcs, partial occlusion, frame/source changes, and the existing rep/countdown rules. [MediaPipe's web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) describes its on-device detector and worker guidance. Physical-person accuracy across clothing, lighting, camera angles, and exercises is not established by these synthetic tests.

## Summary traffic and database results

Trainee polling queries only that trainee's enrollment/metric, avoiding class-wide private metric reads on every device. The coach still receives the complete authorized roster. Local SQLite summary writes, including rate limits, are queued because SQLite has a single writer. PostgreSQL remains concurrent, with up to two retries for serialization conflicts. Retries do not charge the rate limit again. API error logs now include sanitized Prisma codes without query data or credentials.

The initial 100-client SQLite run produced transaction contention and was stopped. After the write fix, both isolated authenticated load tests completed with no failed requests. Each trainee uploaded a summary and polled class state every three seconds, with staggered starts; one coach also polled. Accounts and sessions were disposable and removed afterward. No LiveKit room was created.

| Local HTTP test | Requests | Failed | Upload p95 | Trainee poll p95 | Coach poll p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30 trainees, 20 rounds, 60 seconds | 1,220 | 0 | 43 ms | 20 ms | 70 ms |
| 100 trainees, 10 rounds, 39 seconds | 2,010 | 0 | 3,273 ms | 171 ms | 400 ms |

Raw results: [30 clients](../results/class-capacity-30-results.json), [100 clients](../results/class-capacity-100-results.json). The 100-client run exceeded its nominal 30-second duration because upload queues grew; it establishes correctness under stress, not acceptable real-time performance at 100 clients on SQLite. Production uses PostgreSQL and needs its own capacity measurement.

Reproduce against a local production server with a local SQLite `.env`:

```sh
npm run build
npm run start
# In another terminal:
npm run test:capacity -- 30 20
npm run test:capacity -- 100 10
```

## Local media measurements

Production LiveKit credentials are absent locally, and the connected Vercel account returned a 403 for this project's configuration. A separate LiveKit 1.13.7 development server was therefore installed from the official Windows release, verified against its published SHA-256 digest, and bound to loopback for a synthetic media rehearsal. The production site was not changed by this work.

The first media rehearsal placed the coach and 30 encoders/receivers in one Edge GPU process; Edge's GPU process crashed during measurement. The browser harness then used separate coach and publisher browsers, with software encoding/decoding for synthetic publishers. All clients and the SFU still share one computer. It is a local integration/decode test, not a distributed internet capacity or physical-workout accuracy test. Windows LiveKit capacity management is unavailable.

The completed 30-browser rehearsal received all 30 feeds at 320×180, roughly 3.40 Mbps in video payload, with zero packet loss. Minimum receive FPS was 5.70, mean FPS 8.38, and six freeze events occurred during the 30-second measurement. It **failed** the declared smoothness target of at least 10 FPS on every feed with no freezes. Sender statistics also showed reduced output (minimum 5.73 FPS), so the test is confounded by the workstation generating all 30 moving canvases. These numbers do not establish smooth production performance. Focus switched to a larger layer, the actual coach mute action muted a browser trainee, and paging left exactly 12 receivers advancing frames. [Raw browser media results](../results/media-capacity-30-results.json).

A separate coach decode test used one browser trainee and 29 official prerecorded simulcast publishers. It passed the same smoothness target: minimum 12.01 FPS, mean 14.90 FPS, zero freezes, zero packet loss, and about 3.36 Mbps received video payload over 30 seconds. Focus, real mute, and paging controls passed again. [Raw coach decode results](../results/media-capacity-30-native-results.json). The workstation has a Ryzen 7 5700U with 16 logical CPUs and about 13.85 GiB RAM; all traffic stayed on localhost. The prerecorded publishers avoid local capture/encoding work and therefore isolate the coach/SFU portion of the pipeline more effectively than the 30-canvas run.

The full 36-tile limit also passed: minimum 12.00 FPS, mean 14.92 FPS, zero freezes, zero packet loss, and 4.03 Mbps received video payload over 30 seconds. Focus, mute, and paging passed. [Raw 36-camera results](../results/media-capacity-36-native-results.json).

To reproduce the isolated media test, install the [official LiveKit server](https://docs.livekit.io/transport/self-hosting/local/) and start it with `--dev` and a configuration that binds signaling and RTC to `127.0.0.1`:

```yaml
port: 7880
bind_addresses: [127.0.0.1]
rtc:
  node_ip: 127.0.0.1
  use_external_ip: false
  tcp_port: 7881
  udp_port: 7882
```

In the app terminal, set development credentials **before both building and starting** so the generated browser security policy allows this endpoint:

```powershell
$env:LIVEKIT_URL = 'ws://127.0.0.1:7880'
$env:LIVEKIT_API_KEY = 'devkey'
$env:LIVEKIT_API_SECRET = 'secret'
npm run build
npm run start
# In another terminal with the same local SQLite .env:
npm run test:media -- 30
# Optional coach decode isolation: place the verified Windows lk.exe at
# test-results/livekit/cli/lk.exe. Uses one browser trainee plus native
# prerecorded simulcast publishers, which do not encode video locally.
node scripts/test-media-capacity.mjs 30 --native
node scripts/test-media-capacity.mjs 36 --native
```

The harness uses disposable accounts and a unique room, exercises the actual coach page, and cleans up after completion. Browser publishers use the installed LiveKit client and the application's encoding settings. Native mode uses the [official LiveKit CLI's prerecorded simulcast demo](https://github.com/livekit/livekit-cli), with automatic subscription disabled for those native publishers. The tested CLI is 2.19.0, verified against its official release digest. Native publication settings are the CLI defaults rather than the application's browser encoding caps. Trainee camera subscription behavior is covered by the separate policy tests; the synthetic trainee pages do not run the workout UI or physical pose inference. A missed smoothness target is saved in the report and returns a nonzero exit code.

## Remaining production and physical validation

A release acceptance run should use 30 real devices or distributed media clients on the configured LiveKit service, with a coach laptop receiving the overview and selecting trainees. Measure received resolution/FPS, freeze duration, packet loss, CPU/memory, join/reconnect success, summary freshness, private cues, mute/help actions, and exercise changes. Include a slower trainee device and a constrained network. Observe the corrected skeleton on real workouts before declaring an accuracy improvement for physical users.

## Application verification

- Production build and TypeScript compilation passed.
- 259 unit checks across 18 files passed, including continuity, joint outliers, rep counting, video policy, and database retry/queue behavior.
- 111 API integration checks passed.
- 37 distinct browser journeys passed across the full run and corrected reruns. Coverage includes actual model loading/CPU recovery and Heavy → Full → Lite adaptation, ten continuous curl reps with injected identity errors, calibration/countdown/guided sets, account onboarding through class completion, private cues/help actions, and responsive gallery accessibility.
- Final gallery checks cover 8, 30, and 48 trainees on phones, laptops, and large screens. Thirty desktop tiles fit without scrolling; 48 paginate. The wider inspector retains the gallery, and live-media stats verified its larger video layer.
- Formatting and `git diff --check` passed. Media rooms/publishers and disposable accounts were cleaned up; the temporary media server was stopped. The local app preview uses its ordinary configuration again.
