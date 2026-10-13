import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
process.loadEnvFile('.env');
const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('API integration tests must run against a local test server.');
const db = new PrismaClient();
const suffix = Date.now();
const password = randomBytes(24).toString('base64url');
const users = [];
let checks = 0;
async function request(path, body, jar = {}, method = body ? 'POST' : 'GET', origin = base) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Origin: origin,
      ...(jar.cookie ? { Cookie: jar.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) jar.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  let json;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}
async function check(path, body, jar, status = 200, method) {
  const result = await request(path, body, jar, method);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.json)}`);
  checks++;
  return result.json;
}
async function signup(name) {
  const jar = {};
  const email = `${name.toLowerCase().replaceAll(' ', '-')}-${suffix}@example.test`;
  const result = await check(
    '/api/auth/sign-up/email',
    { name, email, password, role: 'admin' },
    jar,
  );
  users.push(result.user.id);
  return { ...jar, id: result.user.id, email };
}
try {
  await check('/api/workspace', undefined, {}, 401);
  const coach = await signup('Coach One'),
    other = await signup('Coach Two'),
    trainee = await signup('Trainee');
  assert.equal((await db.user.findUnique({ where: { id: coach.id } })).role, 'unset');
  checks++;
  await check(
    '/api/command',
    {
      action: 'onboard',
      role: 'coach',
      name: 'Coach One',
      studioName: 'Integration Studio',
      adult: true,
    },
    coach,
  );
  await check(
    '/api/command',
    { action: 'onboard', role: 'coach', name: 'Coach Two', adult: true },
    other,
  );
  await check(
    '/api/command',
    { action: 'onboard', role: 'trainee', name: 'Trainee', adult: true },
    trainee,
  );
  await check(
    '/api/command',
    { action: 'onboard', role: 'coach', name: 'New Role', adult: true },
    trainee,
    409,
  );
  const invite = await check('/api/command', { action: 'invite', email: trainee.email }, coach);
  await check('/api/command', { action: 'acceptInvite', code: invite.code }, trainee);
  await check('/api/command', { action: 'acceptInvite', code: invite.code }, trainee, 400);
  const workspace = await check('/api/workspace', undefined, coach);
  assert.equal(workspace.clients.length, 1);
  checks++;
  const supportedExercises = [
    'squat',
    'pushup',
    'curl',
    'plank',
    'lunge',
    'shoulderpress',
    'lateralraise',
    'jumpingjack',
    'glutebridge',
    'crunch',
    'row',
    'sideplank',
  ];
  const plan = await check(
    '/api/command',
    {
      action: 'savePlan',
      name: 'Full exercise catalog',
      description: 'Integration coverage for all tracked movements',
      blocks: supportedExercises.map((exercise) => ({ exercise, sets: 2, reps: 10, rest: 30 })),
    },
    coach,
  );
  const savedPlan = await db.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.deepEqual(
    savedPlan.blocks.map((block) => block.exercise),
    supportedExercises,
  );
  checks++;
  const start = new Date(Date.now() + 3600000).toISOString();
  await check(
    '/api/command',
    { action: 'assignPlan', userId: trainee.id, planId: plan.id },
    trainee,
    403,
  );
  await check(
    '/api/command',
    { action: 'assignPlan', userId: trainee.id, planId: plan.id },
    other,
    404,
  );
  await check('/api/command', { action: 'assignPlan', userId: trainee.id, planId: plan.id }, coach);
  await check(
    '/api/command',
    { action: 'coachNote', userId: trainee.id, note: 'Private training note' },
    coach,
  );
  await check(
    '/api/command',
    { action: 'coachNote', userId: trainee.id, note: 'Forbidden' },
    trainee,
    403,
  );
  await check(
    '/api/command',
    { action: 'coachNote', userId: trainee.id, note: 'Forbidden' },
    other,
    404,
  );
  const checkIn = {
    action: 'checkIn',
    energy: 4,
    soreness: 2,
    effort: 7,
    sleepHours: 8,
    bodyweightKg: 72.5,
    note: 'Ready to train',
  };
  await check('/api/command', checkIn, coach, 403);
  await check('/api/command', { ...checkIn, energy: 6 }, trainee, 400);
  await check('/api/command', checkIn, trainee);
  const record = {
    clientId: randomUUID(),
    classId: null,
    revision: 0,
    exercise: 'curl',
    ruleVersion: 'profile-v3',
    setNumber: 1,
    target: 2,
    reps: 2,
    holdMs: 0,
    activeMs: 9000,
    trackedMs: 8000,
    formScore: 80,
    qualityScore: 92,
    rangeDegrees: 95,
    repSeconds: 2,
    confidence: 0.9,
    rejectedReps: 1,
    loadKg: 5,
    completed: true,
    startedAt: new Date(Date.now() - 10000).toISOString(),
    endedAt: new Date().toISOString(),
  };
  await check('/api/workout-sets', record, {}, 401);
  await check('/api/workout-sets', { ...record, ownerId: other.id }, trainee, 403);
  await check('/api/workout-sets', { ...record, trackedMs: 10000 }, trainee, 400);
  await check('/api/workout-sets', { ...record, completed: false }, trainee, 400);
  const recorded = await check('/api/workout-sets', record, trainee);
  const duplicate = await check('/api/workout-sets', { ...record, reps: 3 }, trainee);
  assert.equal(recorded.id, duplicate.id);
  assert.equal((await db.workoutSet.findUniqueOrThrow({ where: { id: recorded.id } })).reps, 2);
  const traineesView = await check('/api/workspace', undefined, trainee);
  const coachesView = await check('/api/workspace', undefined, coach);
  const unrelatedView = await check('/api/workspace', undefined, other);
  assert.equal(traineesView.assignments[0].planId, plan.id);
  assert.equal(traineesView.workoutSets[0].reps, 2);
  assert.equal(coachesView.clients[0].coachNote, 'Private training note');
  assert.equal(JSON.stringify(traineesView).includes('Private training note'), false);
  assert.equal(coachesView.checkIns[0].bodyweightKg, 72.5);
  assert.deepEqual(
    [
      unrelatedView.workoutSets.length,
      unrelatedView.assignments.length,
      unrelatedView.checkIns.length,
    ],
    [0, 0, 0],
  );
  checks += 8;
  await check(
    '/api/command',
    {
      action: 'createClass',
      title: 'Forbidden client',
      startsAt: start,
      duration: 45,
      capacity: 8,
      participantIds: [trainee.id],
    },
    other,
    403,
  );
  const item = await check(
    '/api/command',
    {
      action: 'createClass',
      title: 'Integration class',
      startsAt: start,
      duration: 45,
      capacity: 8,
      participantIds: [trainee.id],
    },
    coach,
  );
  const allClass = await check(
    '/api/command',
    {
      action: 'createClass',
      title: 'Entire studio',
      startsAt: start,
      duration: 45,
      capacity: 1,
      participantIds: [],
      includeAllClients: true,
    },
    coach,
  );
  const allView = await check(`/api/classes/${allClass.id}`, undefined, coach);
  assert.equal(allView.participantCount, 1);
  checks++;
  assert.deepEqual(
    allView.participants.map((person) => person.id),
    [trainee.id],
  );
  checks++;
  await check(`/api/classes/${item.id}`, undefined, other, 404);
  await check(
    '/api/command',
    { action: 'classControl', id: item.id, control: 'start' },
    trainee,
    403,
  );
  await check('/api/video/token', { classId: item.id }, trainee, 409);
  await check('/api/command', { action: 'classControl', id: item.id, control: 'start' }, coach);
  await check('/api/video/token', { classId: item.id }, trainee, 403);
  await check(
    '/api/workout-sets',
    { ...record, clientId: randomUUID(), classId: item.id },
    trainee,
    403,
  );
  await check('/api/command', { action: 'consent', id: item.id, consent: true }, trainee);
  await db.classSession.update({
    where: { id: item.id },
    data: { startedAt: new Date(Date.now() - 20000) },
  });
  const firstConsent = new Date(Date.now() - 15000);
  await db.enrollment.update({
    where: { classId_userId: { classId: item.id, userId: trainee.id } },
    data: { consentAt: firstConsent },
  });
  // Rejoining preserves the beginning of the consented reporting window.
  await check('/api/command', { action: 'consent', id: item.id, consent: true }, trainee);
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({
        where: { classId_userId: { classId: item.id, userId: trainee.id } },
      })
    ).consentAt.getTime(),
    firstConsent.getTime(),
  );
  checks++;
  await check(
    '/api/workout-sets',
    { ...record, clientId: randomUUID(), classId: item.id, exercise: 'squat' },
    trainee,
  );
  await check(
    '/api/workout-sets',
    { ...record, clientId: randomUUID(), classId: item.id },
    other,
    404,
  );
  await check(
    '/api/workout-sets',
    { ...record, clientId: randomUUID(), classId: item.id, revision: 100 },
    trainee,
    409,
  );
  const metric = {
    classId: item.id,
    exercise: 'squat',
    revision: 0,
    reps: 12,
    holdSeconds: 0,
    score: 90,
    confidence: 0.95,
    phase: 'start position',
    cue: 'Continue comfortably.',
  };
  await check('/api/metrics', metric, trainee);
  await check('/api/metrics', { ...metric, reps: 1000 }, trainee, 400);
  await check('/api/metrics', { ...metric, holdSeconds: 1 }, trainee, 400);
  await check('/api/command', { action: 'muteParticipants', id: item.id }, trainee, 403);
  await check('/api/command', { action: 'muteParticipants', id: item.id }, other, 404);
  await check(
    '/api/command',
    { action: 'muteParticipants', id: item.id, participantId: other.id },
    coach,
    400,
  );
  await check('/api/metrics', { ...metric, reps: 1 }, trainee, 409);
  await check('/api/command', { action: 'classControl', id: item.id, control: 'pause' }, coach);
  await check('/api/metrics', { ...metric, reps: 3 }, trainee, 409);
  await check('/api/command', { action: 'classControl', id: item.id, control: 'resume' }, coach);
  const resumed = await check(`/api/classes/${item.id}`, undefined, coach);
  assert.equal(resumed.revision, metric.revision);
  await check('/api/metrics', metric, trainee);
  await check('/api/metrics', { ...metric, holdSeconds: 100 }, trainee, 400);
  await check(
    '/api/command',
    {
      action: 'message',
      id: item.id,
      text: 'Private coaching cue',
      kind: 'cue',
      recipientId: trainee.id,
    },
    coach,
  );
  await check(
    '/api/command',
    { action: 'message', id: item.id, text: 'Spoofed coach cue', kind: 'cue' },
    trainee,
    403,
  );
  await check(
    '/api/command',
    { action: 'message', id: item.id, text: 'Wrong target', recipientId: other.id },
    coach,
    400,
  );
  const foreign = await check('/api/workspace', undefined, other);
  assert.equal(foreign.classes.length, 0);
  assert.equal(foreign.clients.length, 0);
  checks++;
  const noOrigin = await request(
    '/api/command',
    { action: 'profile', name: 'Trainee', goal: 'Move well' },
    trainee,
    'POST',
    'https://attacker.example',
  );
  assert.equal(noOrigin.status, 403);
  checks++;
  await check(
    '/api/command',
    { action: 'classControl', id: item.id, control: 'exercise', exercise: 'curl' },
    coach,
  );
  await check('/api/metrics', metric, trainee, 409);
  let revision = 1;
  for (const exercise of supportedExercises.slice(4)) {
    await check(
      '/api/command',
      {
        action: 'classControl',
        id: item.id,
        control: 'exercise',
        exercise,
      },
      coach,
    );
    revision++;
    const isHold = exercise === 'sideplank';
    await check(
      '/api/metrics',
      {
        ...metric,
        exercise,
        revision,
        reps: isHold ? 0 : 1,
        holdSeconds: isHold ? 1 : 0,
        phase: isHold ? 'holding' : 'start position',
      },
      trainee,
    );
    const persisted = await db.metric.findFirstOrThrow({
      where: { enrollment: { classId: item.id, userId: trainee.id } },
    });
    assert.equal(persisted.exercise, exercise);
    assert.equal(persisted.revision, revision);
    assert.equal(persisted.holdSeconds, isHold ? 1 : 0);
    checks++;
  }
  await check('/api/command', { action: 'classControl', id: item.id, control: 'end' }, coach);
  const endedView = await check(`/api/classes/${item.id}`, undefined, trainee);
  assert.equal(endedView.status, 'completed');
  assert.ok(endedView.endedAt);
  assert.equal(endedView.participants.length, 1);
  assert.equal(endedView.participants[0].summary.totalReps, 19);
  assert.equal(endedView.participants[0].summary.totalHoldSeconds, 1);
  checks++;
  await check('/api/video/token', { classId: item.id }, trainee, 409);
  const personal = await check('/api/export', undefined, trainee);
  assert.equal(personal.profile.email, trainee.email);
  assert.equal(personal.workouts[0].summary.totalReps, 19);
  assert.equal(personal.workouts[0].summary.totalHoldSeconds, 1);
  assert.equal(personal.workoutSets.length, 2);
  assert.equal(personal.checkIns[0].note, 'Ready to train');
  assert.equal(JSON.stringify(personal).includes('Private training note'), false);
  checks += 4;
  checks++;
  // Scheduling, shared profiles, and removal must keep ownership and history intact.
  const beforeEdit = await check('/api/workspace', undefined, coach);
  const editable = beforeEdit.classes.find((session) => session.id === allClass.id);
  const update = {
    action: 'updateClass',
    id: allClass.id,
    expectedVersion: editable.editVersion,
    title: 'Rescheduled foundations',
    startsAt: new Date(Date.now() + 7200000).toISOString(),
    duration: 60,
    capacity: 30,
    planId: plan.id,
    participantIds: [trainee.id],
  };
  await check('/api/command', update, trainee, 403);
  await check('/api/command', update, other, 404);
  await check('/api/command', { ...update, participantIds: [other.id] }, coach, 403);
  await check('/api/command', { ...update, participantIds: [trainee.id, trainee.id] }, coach, 400);
  await check('/api/command', { ...update, capacity: 101 }, coach, 400);
  await check(
    '/api/command',
    { ...update, startsAt: new Date(Date.now() - 3600000).toISOString() },
    coach,
    400,
  );
  await check('/api/command', update, coach);
  await check('/api/command', update, coach, 409);
  const edited = (await check('/api/workspace', undefined, coach)).classes.find(
    (session) => session.id === allClass.id,
  );
  assert.deepEqual(
    [edited.title, edited.startsAt, edited.duration, edited.capacity, edited.planId],
    [update.title, update.startsAt, 60, 30, plan.id],
  );
  const traineeEdited = (await check('/api/workspace', undefined, trainee)).classes.find(
    (session) => session.id === allClass.id,
  );
  assert.equal(traineeEdited.startsAt, update.startsAt);
  assert.equal(traineeEdited.editVersion, undefined);
  checks += 3;
  const updatedPoll = await check(`/api/classes/${allClass.id}`, undefined, trainee);
  assert.deepEqual(
    [
      updatedPoll.title,
      updatedPoll.startsAt,
      updatedPoll.duration,
      updatedPoll.planId,
      updatedPoll.participantCount,
    ],
    [update.title, update.startsAt, 60, plan.id, 1],
  );
  assert.deepEqual(updatedPoll.workout, edited.workout);
  checks++;
  await check(
    '/api/command',
    { ...update, expectedVersion: edited.editVersion, participantIds: [] },
    coach,
  );
  await check(`/api/classes/${allClass.id}`, undefined, trainee, 404);
  const without = (await check('/api/workspace', undefined, coach)).classes.find(
    (session) => session.id === allClass.id,
  );
  await check('/api/command', { ...update, expectedVersion: without.editVersion }, coach);
  const concurrent = (await check('/api/workspace', undefined, coach)).classes.find(
    (session) => session.id === allClass.id,
  );
  const concurrentResults = await Promise.all(
    ['First editor', 'Second editor'].map((title) =>
      request('/api/command', { ...update, title, expectedVersion: concurrent.editVersion }, coach),
    ),
  );
  assert.deepEqual(concurrentResults.map((result) => result.status).sort(), [200, 409]);
  checks++;
  const profile = (await check('/api/workspace', undefined, coach)).clients.find(
    (person) => person.id === trainee.id,
  );
  const editProfile = {
    action: 'clientProfile',
    userId: trainee.id,
    name: 'Updated Trainee',
    goal: 'Build a consistent strength routine',
    expectedName: profile.name,
    expectedGoal: profile.goal,
  };
  await check('/api/command', editProfile, other, 404);
  await check('/api/command', editProfile, trainee, 403);
  await check('/api/command', { ...editProfile, email: 'changed@example.test' }, coach, 400);
  await check('/api/command', editProfile, coach);
  await check('/api/command', editProfile, coach, 409);
  const shared = await check('/api/workspace', undefined, trainee);
  assert.equal(shared.user.name, editProfile.name);
  assert.equal(shared.user.goal, editProfile.goal);
  assert.equal(shared.user.email, trainee.email);
  const coachSummary = (await check('/api/workspace', undefined, coach)).clients.find(
    (person) => person.id === trainee.id,
  );
  assert.equal(coachSummary.latestCheckIn.note, 'Ready to train');
  assert.equal(coachSummary.completedSetsThisWeek, 2);
  checks += 5;
  await check('/api/command', { action: 'removeClient', userId: trainee.id }, other, 404);
  await check('/api/command', { action: 'removeClient', userId: trainee.id }, trainee, 403);
  await check('/api/command', { action: 'classControl', id: allClass.id, control: 'start' }, coach);
  const liveEdit = (await check('/api/workspace', undefined, coach)).classes.find(
    (session) => session.id === allClass.id,
  );
  await check('/api/command', { ...update, expectedVersion: liveEdit.editVersion }, coach, 409);
  await check('/api/command', { action: 'removeClient', userId: trainee.id }, coach, 409);
  await check('/api/command', { action: 'classControl', id: allClass.id, control: 'end' }, coach);
  const future = await check(
    '/api/command',
    {
      action: 'createClass',
      title: 'Future removed enrollment',
      startsAt: start,
      duration: 30,
      capacity: 30,
      participantIds: [trainee.id],
    },
    coach,
  );
  const pending = await check('/api/command', { action: 'invite', email: trainee.email }, coach);
  const historyCount = await db.workoutSet.count({ where: { userId: trainee.id } });
  const futureSnapshot = (await check('/api/workspace', undefined, coach)).classes.find(
    (session) => session.id === future.id,
  );
  // Assignment and new enrollment race against membership removal. Whichever
  // operation wins, removal must leave no future access or ghost assignment.
  const racingChanges = await Promise.all([
    request('/api/command', { action: 'removeClient', userId: trainee.id }, coach),
    request('/api/command', { action: 'assignPlan', userId: trainee.id, planId: plan.id }, coach),
    request(
      '/api/command',
      {
        action: 'createClass',
        title: 'Concurrent enrollment',
        startsAt: start,
        duration: 30,
        capacity: 1,
        participantIds: [trainee.id],
      },
      coach,
    ),
  ]);
  assert.equal(racingChanges[0].status, 200);
  assert.ok([200, 404].includes(racingChanges[1].status));
  assert.ok([200, 403].includes(racingChanges[2].status));
  assert.equal(
    await db.enrollment.count({
      where: { userId: trainee.id, class: { status: 'scheduled' } },
    }),
    0,
  );
  checks += 4;
  await check(
    '/api/command',
    { ...update, id: future.id, participantIds: [], expectedVersion: futureSnapshot.editVersion },
    coach,
    409,
  );
  await check('/api/command', { action: 'acceptInvite', code: pending.code }, trainee, 400);
  await check(`/api/classes/${future.id}`, undefined, trainee, 404);
  const removed = await check('/api/workspace', undefined, coach);
  const independent = await check('/api/workspace', undefined, trainee);
  assert.equal(removed.clients.length, 0);
  assert.equal(removed.assignments.length, 0);
  assert.equal(removed.workoutSets.filter((set) => set.userId === trainee.id).length, 0);
  assert.equal(independent.studio, null);
  assert.equal(independent.workoutSets.length, historyCount);
  assert.equal(
    independent.classes.some((session) => session.id === item.id && session.status === 'completed'),
    true,
  );
  assert.equal(await db.enrollment.count({ where: { classId: item.id, userId: trainee.id } }), 1);
  checks += 7;
  await check(
    '/api/command',
    { action: 'coachNote', userId: trainee.id, note: 'Access revoked' },
    coach,
    404,
  );
  const health = await check('/api/health');
  assert.equal(health.status, 'ok');
  checks++;
  await check('/api/retention', undefined, {}, 401);
  console.log(
    `PASS: ${checks} authentication, access-control, lifecycle, metrics, and export checks.`,
  );
} finally {
  await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
}
