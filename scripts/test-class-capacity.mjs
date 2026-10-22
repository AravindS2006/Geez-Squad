import { grantLocalTestTerm } from './test-member-fixture.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

process.loadEnvFile('.env');
const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
assert(
  ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
  'Capacity tests require a local server.',
);
assert(process.env.DATABASE_URL?.startsWith('file:'), 'Use a local SQLite test database.');
const count = Number(process.argv[2] || 30),
  rounds = Number(process.argv[3] || 20);
assert(Number.isInteger(count) && count >= 1 && count <= 100);
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20);
const db = new PrismaClient(),
  run = randomUUID(),
  users = [],
  measurements = [];
let classId;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, client, body) {
  const began = performance.now();
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(15000),
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      Cookie: client.cookie || '',
      'x-forwarded-for': client.address,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) client.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const data = await response.json();
  return { status: response.status, data, ms: performance.now() - began };
}
async function createClient(index) {
  const client = { address: `2001:db8:${randomBytes(2).toString('hex')}:${index.toString(16)}::1` };
  const email = `capacity-${run}-${index}@example.test`;
  const signup = await request('/api/auth/sign-up/email', client, {
    email,
    name: `Capacity ${index}`,
    password: randomBytes(24).toString('base64url'),
  });
  assert.equal(signup.status, 200, `Signup failed: ${signup.status}`);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  users.push(user.id);
  return { ...client, id: user.id };
}
try {
  const coach = await createClient(0);
  const studio = await db.studio.create({ data: { ownerId: coach.id, name: `Capacity ${run}` } });
  await db.user.update({ where: { id: coach.id }, data: { role: 'coach' } });
  const trainees = [];
  // Bounded signup concurrency avoids treating account creation as class traffic.
  for (let i = 1; i <= count; i += 4)
    trainees.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(4, count - i + 1) }, (_, j) => createClient(i + j)),
      )),
    );
  for (const trainee of trainees) await grantLocalTestTerm(db, studio.id, trainee.id);
  const session = await db.classSession.create({
    data: {
      studioId: studio.id,
      title: `Capacity test ${run}`,
      startsAt: new Date(),
      startedAt: new Date(),
      status: 'live',
      capacity: count,
      enrollments: { create: trainees.map((t) => ({ userId: t.id, consentAt: new Date() })) },
    },
  });
  classId = session.id;
  console.log(
    `Testing ${count} authenticated trainees and one coach for ${rounds} three-second rounds. No video room is created.`,
  );
  const began = performance.now();
  for (let round = 0; round < rounds; round++) {
    const target = began + round * 3000;
    await delay(Math.max(0, target - performance.now()));
    await Promise.all([
      ...trainees.map(async (client, index) => {
        await delay(index * (2700 / count));
        const metric = await request('/api/metrics', client, {
          classId,
          exercise: 'squat',
          revision: 0,
          reps: round + 1,
          holdSeconds: 0,
          score: 85,
          confidence: 0.95,
          phase: 'working',
          cue: 'Controlled movement.',
        });
        measurements.push({ endpoint: 'metrics', status: metric.status, ms: metric.ms });
        const state = await request(`/api/classes/${classId}`, client);
        measurements.push({ endpoint: 'trainee-poll', status: state.status, ms: state.ms });
        assert.equal(state.status, 200);
        assert.equal(
          state.data.participants.length,
          1,
          'A trainee received classmates’ private metrics.',
        );
        assert.equal(state.data.participants[0].id, client.id);
      }),
      (async () => {
        const state = await request(`/api/classes/${classId}`, coach);
        measurements.push({ endpoint: 'coach-poll', status: state.status, ms: state.ms });
        assert.equal(state.status, 200);
        assert.equal(state.data.participants.length, count);
      })(),
    ]);
    const failures = measurements.filter((m) => m.status !== 200);
    assert.equal(
      failures.length,
      0,
      'Capacity requests failed: ' +
        JSON.stringify(failures.map(({ endpoint, status }) => ({ endpoint, status })).slice(0, 5)),
    );
    if ((round + 1) % 5 === 0) console.log('Completed ' + (round + 1) + '/' + rounds + ' rounds.');
  }
  const final = await request(`/api/classes/${classId}`, coach);
  assert(
    final.data.participants.every((p) => p.metric?.reps === rounds),
    'Some trainee summaries did not reach the coach.',
  );
  const summarize = (rows) => {
    const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
    return {
      requests: rows.length,
      failures: rows.filter((r) => r.status !== 200).length,
      p50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
      p95Ms: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
      maxMs: Math.round(sorted.at(-1)),
    };
  };
  const report = {
    createdAt: new Date().toISOString(),
    clients: count,
    rounds,
    durationSeconds: Math.round((performance.now() - began) / 1000),
    scope:
      'Local HTTP/auth/database summary load; does not measure WebRTC, WAN latency, or physical-camera pose accuracy.',
    endpoints: Object.fromEntries(
      ['metrics', 'trainee-poll', 'coach-poll'].map((name) => [
        name,
        summarize(measurements.filter((m) => m.endpoint === name)),
      ]),
    ),
  };
  await writeFile(
    `docs/class-capacity-${count}-results.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  assert(
    measurements.every((m) => m.status === 200),
    'Capacity test had failed requests.',
  );
} finally {
  if (classId) await db.classSession.deleteMany({ where: { id: classId } });
  await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
}
