import { grantLocalTestTerm } from './test-member-fixture.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

process.loadEnvFile('.env');
const origin = 'http://localhost:3000';
const mediaUrl = 'ws://127.0.0.1:7880';
// Development credentials from LiveKit's --dev mode, restricted to a local server.
const apiKey = 'devkey',
  apiSecret = 'secret';
assert.ok(process.env.DATABASE_URL?.startsWith('file:'), 'Use a disposable local SQLite setup.');
const count = Number(process.argv[2] || 30);
const native = process.argv.includes('--native');
const cli = path.resolve('test-results/livekit/cli/lk.exe');
const nativeProcesses = [];
if (native) await access(cli);
assert.ok(Number.isInteger(count) && count >= 17 && count <= 36);
const fixtureId = randomUUID();
const email = `media-coach-${fixtureId}@example.test`;
const ids = Array.from({ length: count }, () => randomUUID());
const db = new PrismaClient();
const service = new RoomServiceClient('http://127.0.0.1:7880', apiKey, apiSecret);
const clientBundle = await readFile(
  new URL('./livekit-client.umd.js', import.meta.resolve('livekit-client')),
  'utf8',
);
const browser = await chromium.launch({
  channel: 'msedge',
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const coach = await context.newPage();
// Keep the synthetic encoders out of the coach browser's GPU process. Encoding
// all 30 participants on the coach's GPU is unlike a distributed classroom.
const publisherBrowser = await chromium.launch({
  channel: 'msedge',
  args: [
    '--disable-gpu',
    '--disable-accelerated-video-encode',
    '--disable-accelerated-video-decode',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const publisherContext = await publisherBrowser.newContext({
  viewport: { width: 400, height: 300 },
});
const publishers = [];
let coachId, session, roomName;
const errors = [];
coach.on('pageerror', (e) => errors.push(e.message));

// Inspect the app's actual WebRTC receivers, without exposing its LiveKit room internals.
await coach.addInitScript(() => {
  const Native = window.RTCPeerConnection;
  window.mediaTestPeers = [];
  window.RTCPeerConnection = class extends Native {
    constructor(...args) {
      super(...args);
      window.mediaTestPeers.push(this);
    }
  };
});
async function stats() {
  return coach.evaluate(async () => {
    const result = [];
    for (const peer of window.mediaTestPeers) {
      if (peer.connectionState === 'closed') continue;
      for (const stat of (await peer.getStats()).values()) {
        if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
          result.push(
            Object.fromEntries(
              [
                'id',
                'timestamp',
                'framesDecoded',
                'bytesReceived',
                'packetsReceived',
                'packetsLost',
                'jitter',
                'frameWidth',
                'frameHeight',
                'framesPerSecond',
                'freezeCount',
                'totalFreezesDuration',
                'totalDecodeTime',
              ].map((key) => [key, stat[key] ?? 0]),
            ),
          );
        }
      }
    }
    return result;
  });
}
async function publisherStats() {
  return Promise.all(
    publishers.map((page) =>
      page.evaluate(() =>
        window.mediaTestRoom.localParticipant.getTrackPublication('camera').track.getSenderStats(),
      ),
    ),
  );
}

try {
  await context.setExtraHTTPHeaders({
    'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`,
  });
  const headers = { Origin: origin };
  const signup = await coach.request.post(`${origin}/api/auth/sign-up/email`, {
    headers,
    data: { email, name: 'Media Coach', password: 'Local-Integration-Only-12345' },
  });
  assert.ok(signup.ok(), `Signup ${signup.status()}`);
  const onboard = await coach.request.post(`${origin}/api/command`, {
    headers,
    data: { action: 'onboard', name: 'Media Coach', role: 'coach', adult: true },
  });
  assert.ok(onboard.ok());
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  coachId = user.id;
  const studio = await db.studio.findUniqueOrThrow({ where: { ownerId: coachId } });
  await db.$transaction(
    ids.map((id, index) =>
      db.user.create({
        data: {
          id,
          name: `Media Trainee ${index + 1}`,
          email: `media-${index}-${fixtureId}@example.test`,
          role: 'trainee',
          memberships: { create: { studioId: studio.id } },
        },
      }),
    ),
  );
  for (const userId of ids) await grantLocalTestTerm(db, studio.id, userId);
  roomName = `geez-squad-media-${fixtureId}`;
  session = await db.classSession.create({
    data: {
      studioId: studio.id,
      title: `Local ${count}-camera rehearsal`,
      exercise: 'squat',
      status: 'live',
      startsAt: new Date(),
      startedAt: new Date(),
      duration: 30,
      capacity: count,
      videoRoomName: roomName,
      enrollments: { create: ids.map((userId) => ({ userId, consentAt: new Date() })) },
    },
  });
  await coach.goto(`${origin}/studio/${session.id}`);
  await coach.getByRole('button', { name: 'Join live video', exact: true }).click();
  await coach.getByRole('checkbox', { name: /I agree to group video/ }).check();
  await coach
    .getByRole('dialog')
    .getByRole('button', { name: 'Join live video', exact: true })
    .click();
  await expect(coach.getByRole('button', { name: 'Leave video', exact: true })).toBeVisible({
    timeout: 30000,
  });
  console.log('Coach joined the actual app classroom.');

  for (let index = 0; index < count; index++) {
    if (native && index > 0) {
      const child = spawn(
        cli,
        [
          '--dev',
          '--url',
          mediaUrl,
          'room',
          'join',
          '--identity',
          ids[index],
          '--publish-demo',
          roomName,
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
      nativeProcesses.push(child);
      await expect
        .poll(
          () =>
            service
              .getParticipant(roomName, ids[index])
              .then((p) => p.tracks.some((t) => t.source === TrackSource.CAMERA))
              .catch(() => false),
          { timeout: 15000 },
        )
        .toBe(true);
      if ((index + 1) % 5 === 0) console.log(`${index + 1}/${count} camera publishers joined.`);
      continue;
    }
    const token = new AccessToken(apiKey, apiSecret, {
      identity: ids[index],
      name: `Media Trainee ${index + 1}`,
      ttl: '20m',
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    });
    const publisher = await publisherContext.newPage();
    publishers.push(publisher);
    publisher.on('console', (message) => {
      if (message.type() === 'error')
        console.log('Publisher error:', message.text().replace(/\?[^\s'"]*/g, '?[query omitted]'));
    });
    publisher.on('requestfailed', (request) => {
      const endpoint = new URL(request.url());
      console.log(
        'Publisher request failed:',
        endpoint.origin + endpoint.pathname,
        request.failure()?.errorText,
      );
    });
    // Load a real localhost response so Chromium classifies the document's
    // network address space correctly for its local-network access checks.
    await publisher.goto(`${origin}/privacy`);
    await publisher.evaluate(() => document.body.replaceChildren());
    await publisher.addScriptTag({ content: clientBundle });
    await publisher.evaluate(
      async ({ token, mediaUrl, coachId, index }) => {
        const { Room, RoomEvent, Track, LocalVideoTrack, VideoPresets } = window.LivekitClient;
        const room = new Room({ adaptiveStream: true, dynacast: true });
        window.mediaTestRoom = room;
        const sync = () => {
          for (const person of room.remoteParticipants.values())
            for (const pub of person.trackPublications.values()) {
              const desired =
                person.identity === coachId && pub.source === 'camera' && !pub.isMuted;
              if (pub.isDesired !== desired) pub.setSubscribed(desired);
            }
        };
        room
          .on(RoomEvent.TrackPublished, sync)
          .on(RoomEvent.TrackUnmuted, sync)
          .on(RoomEvent.Reconnected, sync);
        room.on(RoomEvent.TrackSubscribed, (track, publication, person) => {
          if (person.identity === coachId && publication.source === 'camera') {
            const video = track.attach();
            video.muted = true;
            video.style.width = '300px';
            document.body.append(video);
            void video.play();
          }
        });
        await room.connect(mediaUrl, token, { autoSubscribe: false });
        sync();
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const draw = () => {
          const t = performance.now() / 500;
          ctx.fillStyle = `hsl(${index * 27},35%,22%)`;
          ctx.fillRect(0, 0, 1280, 720);
          for (let x = 0; x < 1280; x += 60) {
            ctx.fillStyle = `hsl(${index * 27 + x / 8},35%,${25 + 8 * Math.sin(t + x / 90)}%)`;
            ctx.fillRect(x, 0, 30, 720);
          }
          ctx.strokeStyle = '#d4efa9';
          ctx.lineWidth = 16;
          const hip = 390 + 90 * Math.sin(t);
          ctx.beginPath();
          ctx.arc(640, hip - 150, 35, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(640, hip - 115);
          ctx.lineTo(640, hip);
          ctx.lineTo(540, 620);
          ctx.moveTo(640, hip);
          ctx.lineTo(740, 620);
          ctx.moveTo(640, hip - 100);
          ctx.lineTo(460, hip - 30);
          ctx.moveTo(640, hip - 100);
          ctx.lineTo(820, hip - 30);
          ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.font = '36px sans-serif';
          ctx.fillText(`Synthetic trainee ${index + 1}`, 35, 60);
        };
        draw();
        window.mediaDrawTimer = setInterval(draw, 1000 / 24);
        const stream = canvas.captureStream(24);
        await room.localParticipant.publishTrack(new LocalVideoTrack(stream.getVideoTracks()[0]), {
          source: Track.Source.Camera,
          simulcast: true,
          videoEncoding: { maxBitrate: 900000, maxFramerate: 24 },
          videoSimulcastLayers: [
            {
              ...VideoPresets.h180,
              resolution: VideoPresets.h180.resolution,
              encoding: { maxBitrate: 120000, maxFramerate: 12 },
            },
            {
              ...VideoPresets.h360,
              resolution: VideoPresets.h360.resolution,
              encoding: { maxBitrate: 350000, maxFramerate: 20 },
            },
          ],
        });
        if (index === 0) {
          const audio = new AudioContext(),
            oscillator = audio.createOscillator(),
            gain = audio.createGain();
          gain.gain.value = 0;
          oscillator.connect(gain);
          const output = audio.createMediaStreamDestination();
          gain.connect(output);
          oscillator.start();
          window.mediaTestAudio = audio;
          await room.localParticipant.publishTrack(output.stream.getAudioTracks()[0], {
            source: Track.Source.Microphone,
          });
        }
      },
      { token: await token.toJwt(), mediaUrl, coachId, index },
    );
    if ((index + 1) % 5 === 0) console.log(`${index + 1}/${count} camera publishers joined.`);
  }
  await expect(coach.getByLabel('Class monitoring summary')).toContainText(
    `${count}/${count} online`,
  );
  await expect
    .poll(
      async () => (await stats()).filter((s) => s.framesDecoded > 0 && s.frameWidth > 0).length,
      { timeout: 45000 },
    )
    .toBe(count);
  await coach.waitForTimeout(5000);
  const firstOutbound = await publisherStats();
  const samples = [await stats()];
  for (let i = 0; i < 6; i++) {
    await coach.waitForTimeout(5000);
    samples.push(await stats());
    console.log(`Measured ${(i + 1) * 5}/30 seconds of coach reception.`);
  }
  const lastOutbound = await publisherStats();
  const publisherOutput = lastOutbound.map((layers, index) =>
    layers
      .filter((layer) => layer.frameWidth > 0)
      .map((last) => {
        const initial = firstOutbound[index].find((layer) => layer.streamId === last.streamId);
        return {
          rid: last.rid,
          width: last.frameWidth,
          height: last.frameHeight,
          fps: initial
            ? (last.framesSent - initial.framesSent) / ((last.timestamp - initial.timestamp) / 1000)
            : null,
          qualityLimitationReason: last.qualityLimitationReason,
          qualityLimitationDurations: last.qualityLimitationDurations,
        };
      }),
  );
  const first = new Map(samples[0].map((s) => [s.id, s]));
  const streams = samples.at(-1).map((last) => {
    const initial = first.get(last.id);
    assert.ok(initial);
    const seconds = (last.timestamp - initial.timestamp) / 1000;
    return {
      width: last.frameWidth,
      height: last.frameHeight,
      fps: (last.framesDecoded - initial.framesDecoded) / seconds,
      kbps: ((last.bytesReceived - initial.bytesReceived) * 8) / seconds / 1000,
      lostPackets: last.packetsLost - initial.packetsLost,
      freezes: last.freezeCount - initial.freezeCount,
      frozenSeconds: last.totalFreezesDuration - initial.totalFreezesDuration,
      decodeMsPerFrame:
        (1000 * (last.totalDecodeTime - initial.totalDecodeTime)) /
        Math.max(1, last.framesDecoded - initial.framesDecoded),
    };
  });
  await mkdir('test-results', { recursive: true });
  await writeFile(
    `test-results/media-${count}-raw.json`,
    JSON.stringify({ samples, streams, publisherOutput }, null, 2),
  );
  assert.equal(streams.length, count);
  assert.ok(
    streams.every((s) => s.fps > 0 && s.width <= 320),
    'Every overview thumbnail should decode current low-layer video.',
  );
  const subscriptionCounts = await Promise.all(
    publishers.map((p) =>
      p.evaluate(
        () =>
          [...window.mediaTestRoom.remoteParticipants.values()].flatMap((person) =>
            [...person.videoTrackPublications.values()].filter((pub) => pub.isDesired),
          ).length,
      ),
    ),
  );
  assert.ok(
    subscriptionCounts.every((n) => n === 1),
    'Each trainee should receive only the coach camera.',
  );
  await mkdir('docs/screenshots', { recursive: true });
  await coach.screenshot({ path: `docs/screenshots/media-${count}-overview.png` });
  await coach.getByRole('button', { name: 'Focus Media Trainee 1', exact: true }).click();
  console.log(
    'Focused video geometry:',
    await coach.locator('.monitor-detail-video video').evaluate((el) => ({
      width: el.clientWidth,
      height: el.clientHeight,
      videoWidth: el.videoWidth,
    })),
  );
  await coach.bringToFront();
  await expect
    .poll(async () => (await stats()).some((s) => s.frameWidth > 320), { timeout: 15000 })
    .toBe(true);
  await coach.getByRole('button', { name: 'Mute trainee', exact: true }).click();
  await expect
    .poll(
      () =>
        publishers[0].evaluate(
          () => window.mediaTestRoom.localParticipant.getTrackPublication('microphone')?.isMuted,
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await coach.getByRole('button', { name: 'Close trainee details' }).click();
  await coach.getByLabel('Gallery density').selectOption('comfortable');
  await expect
    .poll(() =>
      service
        .listParticipants(roomName)
        .then((people) => people.find((p) => p.identity === coachId)?.tracks.length || 0),
    )
    .toBeGreaterThanOrEqual(1);
  await coach.waitForTimeout(3500);
  const activeVideos = await coach
    .locator('.monitor-gallery video')
    .evaluateAll((videos) => videos.filter((v) => v.srcObject && v.readyState >= 2).length);
  assert.equal(activeVideos, 12);
  // Check media frame counters as well as DOM layout: only visible feeds advance.
  const coachParticipant = await service.getParticipant(roomName, coachId);
  assert.equal(coachParticipant.permission.canSubscribe, true);
  const beforePage = await stats();
  await coach.waitForTimeout(2000);
  const afterPage = await stats();
  const beforeFrames = new Map(beforePage.map((s) => [s.id, s.framesDecoded]));
  const activeReceivers = afterPage.filter(
    (s) => s.framesDecoded > (beforeFrames.get(s.id) || 0),
  ).length;
  assert.equal(activeReceivers, 12);
  assert.deepEqual(errors, []);
  const report = {
    timestamp: new Date().toISOString(),
    server: 'LiveKit 1.13.7 Windows, localhost',
    browserProcesses: 2,
    pages: publishers.length + 1,
    nativePublishers: nativeProcesses.length,
    publisher: native
      ? `One browser canvas using application encoding settings; ${count - 1} official LiveKit CLI prerecorded simulcast publishers (no on-host encoding)`
      : 'Synthetic 720p/24 FPS moving canvas, matching application simulcast settings; separate publisher browser with software encoding/decoding',
    measurementSeconds: 30,
    overview: {
      streams,
      kbps: streams.reduce((n, s) => n + s.kbps, 0),
      minimumFps: Math.min(...streams.map((s) => s.fps)),
      totalLostPackets: streams.reduce((n, s) => n + s.lostPackets, 0),
      totalFreezes: streams.reduce((n, s) => n + s.freezes, 0),
    },
    publisherOutput,
    performanceTarget: {
      minimumPerStreamFps: 10,
      maximumFreezes: 0,
      met: streams.every((s) => s.fps >= 10 && s.freezes === 0),
    },
    traineeCameraSubscriptions: subscriptionCounts,
    focusReceivedLargerLayer: true,
    realCoachMuteSucceeded: true,
    pagedCoachActiveReceivers: activeReceivers,
    pageErrors: errors,
    limitations:
      'All publishers, the coach browser and SFU share one computer. No physical pose inference or WAN impairment. Windows SFU capacity management is unavailable.',
  };
  await writeFile(
    `docs/media-capacity-${count}${native ? '-native' : ''}-results.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      cameras: count,
      kbps: report.overview.kbps,
      minimumFps: report.overview.minimumFps,
      lostPackets: report.overview.totalLostPackets,
      freezes: report.overview.totalFreezes,
      activeReceiversAfterPaging: activeReceivers,
      performanceTargetMet: report.performanceTarget.met,
    }),
  );
  if (!report.performanceTarget.met) process.exitCode = 1;
} finally {
  for (const child of nativeProcesses) child.kill();
  await publisherBrowser.close();
  await browser.close();
  if (roomName) await service.deleteRoom(roomName).catch(() => {});
  const fixtureCoach =
    coachId || (await db.user.findUnique({ where: { email }, select: { id: true } }))?.id;
  if (fixtureCoach)
    await db.classSession.deleteMany({ where: { studio: { ownerId: fixtureCoach } } });
  await db.user.deleteMany({
    where: { id: { in: [...ids, ...(fixtureCoach ? [fixtureCoach] : [])] } },
  });
  await db.$disconnect();
}
