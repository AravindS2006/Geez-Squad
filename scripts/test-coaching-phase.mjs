import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { provisionTestAdmin } from './local-studio-fixture.mjs';
import { grantLocalTestTerm } from './test-member-fixture.mjs';
process.loadEnvFile('.env');
const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
if (
  !process.env.DATABASE_URL?.startsWith('file:') ||
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname)
)
  throw new Error('Local disposable test database/server required.');
const db = new PrismaClient(),
  ids = [],
  prefix = randomUUID();
let checks = 0;
async function request(actor, path, body, expected = 200) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'X-Coaching-Client': '2',
      'x-forwarded-for': actor.ip,
      ...(actor.cookie ? { Cookie: actor.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.headers.getSetCookie().length)
    actor.cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  checks++;
  return result;
}
async function account(name) {
  const actor = { ip: `2001:db8:${randomBytes(2).toString('hex')}::1`, cookie: '' },
    email = `${name}-${prefix}@example.test`;
  await request(actor, '/api/auth/sign-up/email', {
    name: `Fixture ${name}`,
    email,
    password: randomBytes(24).toString('base64url'),
  });
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  ids.push(user.id);
  actor.id = user.id;
  await request(actor, '/api/command', {
    action: 'onboard',
    name: user.name,
    role: 'trainee',
    adult: true,
  });
  return actor;
}
try {
  const coach = await account('coach'),
    trainee = await account('trainee'),
    outsider = await account('outsider');
  const studio = await provisionTestAdmin(db, coach.id);
  await grantLocalTestTerm(db, studio.id, trainee.id);
  const custom = await request(
    coach,
    '/api/exercises',
    {
      action: 'create',
      name: 'Coach cable movement',
      equipment: 'Cable',
      instructions: 'Follow the demonstrated movement with a comfortable range.',
      targetUnit: 'reps',
    },
    201,
  );
  await request(
    trainee,
    '/api/exercises',
    {
      action: 'create',
      name: 'Forbidden',
      equipment: '',
      instructions: 'This must be rejected.',
      targetUnit: 'reps',
    },
    403,
  );
  await request(
    outsider,
    '/api/exercises',
    {
      action: 'create',
      name: 'Forbidden',
      equipment: '',
      instructions: 'This must be rejected.',
      targetUnit: 'reps',
    },
    403,
  );
  const blocks = [
    { exercise: 'curl', armMode: 'both', sets: 1, reps: 10, rest: 0 },
    { exercise: 'curl', armMode: 'alternating', sets: 1, reps: 10, rest: 0 },
    { exercise: custom.exercise.id, sets: 1, reps: 10, rest: 0 },
  ];
  const plan = await request(coach, '/api/command', {
    action: 'savePlan',
    name: 'Occurrence identity',
    description: '',
    blocks,
  });
  const storedPlan = await db.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(new Set(storedPlan.blocks.map((b) => b.id)).size, 3);
  checks++;
  await request(
    coach,
    '/api/command',
    {
      action: 'savePlan',
      name: 'Invalid modes',
      description: '',
      blocks: [{ exercise: 'squat', armMode: 'both', sets: 1, reps: 10, rest: 0 }],
    },
    400,
  );
  const record = {
    schemaVersion: 2,
    runId: randomUUID(),
    blockId: storedPlan.blocks[0].id,
    clientId: randomUUID(),
    classId: null,
    revision: 0,
    exercise: 'curl',
    ruleVersion: 'profile-v8',
    armMode: 'both',
    arms: {
      left: { reps: 2, rangeDegrees: 100, repSeconds: 2, trackedMs: 8000, activeMs: 10000 },
      right: { reps: 2, rangeDegrees: 98, repSeconds: 2, trackedMs: 8000, activeMs: 10000 },
    },
    measurementSource: 'automatic',
    targetUnit: 'reps',
    loadBasis: 'per-hand',
    setNumber: 1,
    target: 2,
    reps: 2,
    holdMs: 0,
    activeMs: 10000,
    trackedMs: 8000,
    formScore: 80,
    qualityScore: 80,
    rangeDegrees: 99,
    repSeconds: 2,
    confidence: 0.95,
    rejectedReps: 0,
    loadKg: 5,
    completed: true,
    startedAt: new Date(Date.now() - 12000).toISOString(),
    endedAt: new Date(Date.now() - 2000).toISOString(),
  };
  const saved = await request(trainee, '/api/workout-sets', record);
  const repeated = await request(trainee, '/api/workout-sets', record);
  assert.equal(repeated.id, saved.id);
  checks++;
  await request(trainee, '/api/workout-sets', { ...record, clientId: randomUUID(), reps: 3 }, 400);
  await request(
    trainee,
    '/api/workout-sets',
    { ...record, clientId: randomUUID(), exercise: custom.exercise.id },
    400,
  );
  const correction = {
    clientId: randomUUID(),
    setId: saved.id,
    reps: 1,
    holdMs: 0,
    reason: 'Coach confirmed one full paired movement.',
  };
  await request(outsider, '/api/workout-sets/corrections', correction, 404);
  await request(coach, '/api/workout-sets/corrections', correction);
  await request(coach, '/api/workout-sets/corrections', correction);
  assert.equal(await db.workoutCorrection.count({ where: { setId: saved.id } }), 1);
  checks++;
  assert.equal((await db.workoutSet.findUniqueOrThrow({ where: { id: saved.id } })).reps, 2);
  checks++;
  const history = await request(trainee, '/api/workout-history?days=30&limit=1');
  assert.equal(history.records[0].arms.left.reps, 2);
  assert.equal(history.totals.reps, 1);
  assert.equal(history.totals.loadVolume, 10);
  checks += 3;
  const privateHistory = await request(
    outsider,
    `/api/workout-history?days=30&userId=${trainee.id}`,
  );
  assert.equal(privateHistory.records.length, 0);
  checks++;
  const manual = {
    ...record,
    clientId: randomUUID(),
    exercise: custom.exercise.id,
    armMode: null,
    arms: null,
    measurementSource: 'manual',
    trackedMs: 0,
    formScore: null,
    qualityScore: null,
    rangeDegrees: null,
    repSeconds: null,
    confidence: null,
  };
  await request(trainee, '/api/workout-sets', manual);
  await request(outsider, '/api/workout-sets', { ...manual, clientId: randomUUID() }, 404);
  const pageOne = await request(trainee, '/api/workout-history?days=30&limit=1');
  assert.ok(pageOne.nextCursor);
  checks++;
  const pageTwo = await request(
    trainee,
    `/api/workout-history?days=30&limit=1&cursor=${encodeURIComponent(pageOne.nextCursor)}`,
  );
  assert.notEqual(pageOne.records[0].id, pageTwo.records[0].id);
  assert.equal(pageTwo.nextCursor, null);
  checks += 2;
  const created = await request(coach, '/api/command', {
    action: 'createClass',
    title: 'Snapshot class',
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    duration: 30,
    capacity: 1,
    planId: plan.id,
    participantIds: [trainee.id],
  });
  await request(coach, '/api/command', {
    action: 'classControl',
    id: created.id,
    control: 'start',
  });
  let session = await request(coach, `/api/classes/${created.id}`);
  assert.equal(session.activeBlockId, storedPlan.blocks[0].id);
  checks++;
  await request(coach, '/api/command', {
    action: 'savePlan',
    id: plan.id,
    name: 'Edited next class',
    description: '',
    blocks: [{ exercise: 'plank', sets: 1, reps: 30, rest: 0 }],
  });
  session = await request(coach, `/api/classes/${created.id}`);
  assert.equal(session.workout.length, 3);
  checks++;
  await request(coach, '/api/command', {
    action: 'classControl',
    id: created.id,
    control: 'exercise',
    exercise: 'curl',
    blockId: storedPlan.blocks[1].id,
  });
  session = await request(coach, `/api/classes/${created.id}`);
  assert.equal(session.activeBlockId, storedPlan.blocks[1].id);
  assert.equal(session.revision, 1);
  assert.equal(session.controlSequence, 2);
  checks += 3;
  await request(
    trainee,
    '/api/exercises',
    { action: 'rollout', measurement: false, library: false, meeting: false },
    403,
  );
  await request(coach, '/api/exercises', {
    action: 'rollout',
    measurement: false,
    library: true,
    meeting: true,
  });
  console.log(
    `PASS: ${checks} coaching contract, privacy, correction, pagination, catalog, snapshot, and rollout checks.`,
  );
} finally {
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
