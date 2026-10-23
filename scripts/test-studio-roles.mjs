import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { provisionTestAdmin } from './local-studio-fixture.mjs';
import { reconcileStudioRoles } from './backfill-studio-roles.mjs';
process.loadEnvFile('.env');
const origin = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
assert(process.env.DATABASE_URL?.startsWith('file:'), 'Disposable local fixtures only.');
const db = new PrismaClient(),
  key = randomUUID(),
  users = [],
  studios = [];
let checks = 0;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
async function call(actor, path, body, expected = 200) {
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'x-forwarded-for': actor.ip,
      ...(actor.cookie ? { Cookie: actor.cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.getSetCookie().length)
    actor.cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
function check(value, message) {
  assert(value, message);
  checks++;
}
async function account(name, verified = true) {
  const actor = {
    ip: `2001:db8:${randomBytes(2).toString('hex')}::1`,
    email: `roles-${name}-${key}@example.test`,
  };
  const result = await call(actor, '/api/auth/sign-up/email', {
    name,
    email: actor.email,
    password: randomBytes(24).toString('base64url'),
  });
  actor.id = result.user.id;
  actor.email = result.user.email;
  users.push(actor.id);
  await call(actor, '/api/command', { action: 'onboard', name, role: 'coach', adult: true }, 400);
  await call(actor, '/api/command', { action: 'onboard', name, role: 'trainee', adult: true });
  if (verified) await db.user.update({ where: { id: actor.id }, data: { emailVerified: true } });
  return actor;
}
async function invite(admin, coach, expected = 502) {
  const result = await call(
    admin,
    '/api/studio-team',
    { action: 'invite', email: coach.email },
    expected,
  );
  if (expected === 502)
    check(
      result.code === 'EMAIL_DELIVERY_FAILED' && result.requestId,
      'Delivery failures include safe support references',
    );
  const requests = await call(coach, '/api/studio-team/requests');
  return requests.requests[0]?.id;
}
try {
  const admin = await account('Admin'),
    otherAdmin = await account('OtherAdmin'),
    coach = await account('Coach'),
    secondCoach = await account('SecondCoach'),
    trainee = await account('Trainee'),
    otherTrainee = await account('OtherTrainee'),
    unverified = await account('Unverified', false);
  const studio = await provisionTestAdmin(db, admin.id);
  studios.push(studio.id);
  const foreign = await provisionTestAdmin(db, otherAdmin.id);
  studios.push(foreign.id);
  await call(coach, '/api/studio-operations', undefined, 403);
  await call(trainee, '/api/studio-team', undefined, 403);
  await db.studioStaff.create({
    data: { studioId: studio.id, name: 'Directory coach', email: coach.email, role: 'Head coach' },
  });
  check(
    !(await call(coach, '/api/workspace')).permissions.coach,
    'Directory title does not grant access',
  );
  const requestId = await invite(admin, coach);
  await call(trainee, '/api/studio-team/requests', { requestId, action: 'accept' }, 404);
  await call(coach, '/api/studio-team/requests', { requestId, action: 'accept' });
  await call(coach, '/api/studio-team/requests', { requestId, action: 'accept' });
  check(
    (await call(coach, '/api/workspace')).permissions.role === 'coach',
    'Explicit accepted coach role',
  );
  await call(coach, '/api/studio-operations', undefined, 403);
  await call(coach, '/api/billing', { action: 'checkout' }, 403);
  await call(coach, '/api/studio-team', { action: 'invite', email: trainee.email }, 403);
  const request2 = await invite(admin, secondCoach);
  await call(secondCoach, '/api/studio-team/requests', { requestId: request2, action: 'accept' });
  const unverifiedRequest = await db.studioTeamRequest.create({
    data: {
      studioId: studio.id,
      email: unverified.email,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await call(
    unverified,
    '/api/studio-team/requests',
    { requestId: unverifiedRequest.id, action: 'accept' },
    403,
  );
  const crossRequest = await db.studioTeamRequest.create({
    data: { studioId: foreign.id, email: coach.email, expiresAt: new Date(Date.now() + 86400000) },
  });
  await call(
    coach,
    '/api/studio-team/requests',
    { requestId: crossRequest.id, action: 'accept' },
    409,
  );
  await db.studioTeamRequest.update({
    where: { id: crossRequest.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await call(
    coach,
    '/api/studio-team/requests',
    { requestId: crossRequest.id, action: 'accept' },
    409,
  );
  await db.studioTeamRequest.update({
    where: { id: crossRequest.id },
    data: { status: 'withdrawn', expiresAt: new Date(Date.now() + 86400000) },
  });
  await call(
    coach,
    '/api/studio-team/requests',
    { requestId: crossRequest.id, action: 'accept' },
    409,
  );
  const offer = await call(admin, '/api/studio-operations', {
    action: 'offer',
    name: 'Real membership fixture',
    description: '',
    durationDays: 90,
    pricePaise: 100000,
    active: true,
  });
  async function addMember(actor) {
    const member = await call(admin, '/api/studio-operations', {
      action: 'member',
      name: actor.email.split('@')[0],
      email: actor.email,
      phone: '',
      goal: 'Strength',
      joinedOn: today,
      status: 'active',
      offerId: offer.id,
      startsOn: today,
    });
    const pending = (await call(actor, '/api/studio-join-requests')).requests[0];
    await call(actor, '/api/studio-join-requests', { requestId: pending.id, action: 'accept' });
    return member.id;
  }
  const memberId = await addMember(trainee),
    secondMemberId = await addMember(otherTrainee);
  const walkIn = await call(admin, '/api/studio-operations', {
    action: 'member',
    name: 'Walk in fixture',
    email: '',
    phone: '1234567890',
    goal: '',
    joinedOn: today,
    status: 'active',
    offerId: offer.id,
    startsOn: today,
  });
  check(
    !(await db.studioMember.findUnique({ where: { id: walkIn.id } })).userId,
    'Walk-in membership never fabricates an account',
  );
  await call(admin, '/api/studio-team', { action: 'assign', memberId, coachId: coach.id });
  await call(
    coach,
    '/api/command',
    { action: 'coachNote', userId: otherTrainee.id, note: 'forged' },
    404,
  );
  await call(
    otherAdmin,
    '/api/studio-team',
    { action: 'assign', memberId, coachId: otherAdmin.id },
    404,
  );
  const boundary = (await db.primaryCoachAssignment.findUnique({ where: { memberId } })).assignedAt;
  for (const [label, createdAt] of [
    ['before', new Date(boundary.getTime() - 1000)],
    ['after', new Date(boundary.getTime() + 1)],
  ])
    await db.checkIn.create({
      data: { userId: trainee.id, energy: 3, soreness: 1, note: label, createdAt },
    });
  for (const [index, startedAt] of [
    new Date(boundary.getTime() - 60000),
    new Date(boundary.getTime() + 1),
  ].entries())
    await db.workoutSet.create({
      data: {
        clientId: randomUUID(),
        userId: trainee.id,
        exercise: 'squat',
        ruleVersion: 'profile-v3',
        setNumber: index + 1,
        target: 1,
        reps: 1,
        activeMs: 1000,
        trackedMs: 1000,
        completed: true,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 2000),
      },
    });
  const view = await call(coach, '/api/workspace');
  check(
    view.clients.length === 1 && view.clients[0].id === trainee.id,
    'Only assigned trainee profiles',
  );
  check(
    view.checkIns.length === 1 &&
      view.checkIns[0].note === 'after' &&
      view.clients[0].latestCheckIn.note === 'after',
    'Assignment boundary applies to history and derived latest check-in',
  );
  check(
    view.workoutSets.length === 1 && view.clients[0].completedSetsThisWeek === 1,
    'Assignment boundary applies to workout history and derived weekly totals',
  );
  await call(coach, '/api/command', {
    action: 'coachNote',
    userId: trainee.id,
    note: 'Current assignment private note',
  });
  const group = await call(admin, '/api/command', {
    action: 'createClass',
    title: 'Cross-coach group',
    hostId: coach.id,
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    duration: 30,
    capacity: 2,
    participantIds: [trainee.id, otherTrainee.id],
  });
  const groupView = await call(coach, `/api/classes/${group.id}`);
  check(
    groupView.participants.length === 2 &&
      groupView.coachId === coach.id &&
      groupView.permissions.canManage,
    'Explicit group host sees class roster only',
  );
  check(
    !(await call(coach, '/api/workspace')).clients.some((c) => c.id === otherTrainee.id),
    'Group host does not gain unrelated longitudinal profile access',
  );
  await call(secondCoach, `/api/classes/${group.id}`, undefined, 404);
  await call(coach, '/api/command', { action: 'classControl', id: group.id, control: 'start' });
  await call(coach, '/api/command', { action: 'consent', id: group.id, consent: true });
  await call(coach, '/api/video/token', { classId: group.id }, 503);
  await call(admin, '/api/studio-team', { action: 'assign', memberId, coachId: secondCoach.id });
  check(
    !(await call(coach, '/api/workspace')).clients.length,
    'Previous coach immediately loses profile access',
  );
  check(
    (await db.coachAssignmentHistory.count({
      where: { memberId, note: 'Current assignment private note' },
    })) === 1,
    'Reassignment preserves historical private notes',
  );
  await call(
    coach,
    '/api/command',
    { action: 'coachNote', userId: trainee.id, note: 'forged' },
    404,
  );
  const physical = await call(admin, '/api/studio-operations', {
    action: 'studioClass',
    title: 'One seat class',
    hostId: coach.id,
    trainer: 'Invited coach',
    location: 'Main studio',
    startsAt: new Date(Date.now() + 7200000).toISOString(),
    duration: 45,
    capacity: 1,
    status: 'scheduled',
  });
  const race = await Promise.all(
    [trainee, otherTrainee].map(async (actor) => {
      const response = await fetch(origin + '/api/my-bookings', {
        method: 'POST',
        headers: { Origin: origin, Cookie: actor.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: physical.id, action: 'book' }),
      });
      return { actor, status: response.status };
    }),
  );
  check(
    race.filter((r) => r.status === 200).length === 1 &&
      race.filter((r) => r.status === 409).length === 1,
    'Capacity race admits exactly one trainee',
  );
  const winner = race.find((r) => r.status === 200).actor;
  await call(
    trainee,
    '/api/my-bookings',
    { classId: physical.id, action: 'book', memberId: secondMemberId },
    400,
  );
  const winnerMember = winner.id === trainee.id ? memberId : secondMemberId;
  await db.memberTerm.updateMany({
    where: { memberId: winnerMember },
    data: { startsOn: '2020-01-01', endsOn: '2020-12-31' },
  });
  await call(winner, '/api/my-bookings', { classId: physical.id, action: 'cancel' });
  check(
    (await db.studioBooking.count({ where: { classId: physical.id, status: 'booked' } })) === 0,
    'Expired member can cancel and release capacity',
  );
  check(
    (await call(winner, '/api/my-bookings')).bookings.some((b) => b.status === 'cancelled'),
    'Cancellation history retained',
  );
  await call(winner, '/api/my-bookings', { classId: physical.id, action: 'book' }, 409);
  const hosted = await call(coach, '/api/studio-team/classes');
  check(
    hosted.classes.length === 1 && !JSON.stringify(hosted).includes('feePaise'),
    'Physical host response excludes finances',
  );
  const historical = await db.classSession.create({
    data: {
      studioId: studio.id,
      hostId: coach.id,
      title: 'Historical coach identity',
      startsAt: new Date(),
      status: 'completed',
    },
  });
  await call(admin, '/api/studio-team', { action: 'status', userId: coach.id, status: 'revoked' });
  check(
    (await db.classSession.findUnique({ where: { id: group.id } })).hostId === admin.id,
    'Live host transfers to admin',
  );
  check(
    (await db.studioClass.findUnique({ where: { id: physical.id } })).hostId === admin.id,
    'Upcoming physical host transfers to admin',
  );
  check(
    (await db.classSession.findUnique({ where: { id: historical.id } })).hostId === coach.id,
    'Historical host identity retained',
  );
  await db.studioRoleGrant.create({
    data: { studioId: foreign.id, userId: coach.id, role: 'coach' },
  });
  await call(
    admin,
    '/api/studio-team',
    { action: 'status', userId: coach.id, status: 'active' },
    409,
  );
  await db.studioRoleGrant.deleteMany({
    where: { studioId: foreign.id, userId: coach.id, role: 'coach' },
  });
  await call(coach, `/api/classes/${group.id}`, undefined, 404);
  await call(coach, '/api/video/token', { classId: group.id }, 404);
  await call(
    admin,
    '/api/studio-team',
    { action: 'status', userId: admin.id, status: 'revoked' },
    403,
  );
  await call(admin, '/api/studio-operations', {
    action: 'member',
    id: memberId,
    name: 'Changed contact',
    email: `changed-contact-${key}@example.test`,
    phone: '',
    goal: 'Strength',
    joinedOn: today,
    status: 'active',
  });
  await call(admin, '/api/command', { action: 'removeClient', userId: trainee.id });
  const restore = await call(
    admin,
    '/api/studio-operations',
    { action: 'memberAccess', memberId, operation: 'restore' },
    502,
  );
  check(
    restore.requestId && restore.code === 'EMAIL_DELIVERY_FAILED',
    'Restore delivery failure keeps confirmation pending',
  );
  const preservedRequest = await db.studioJoinRequest.findUnique({ where: { memberId } });
  check(
    preservedRequest.email === trainee.email && preservedRequest.targetUserId === trainee.id,
    'Restore targets the original linked account after contact email edits',
  );
  const restoreRequest = (await call(trainee, '/api/studio-join-requests')).requests[0];
  await call(
    otherTrainee,
    '/api/studio-join-requests',
    { requestId: restoreRequest.id, action: 'accept' },
    404,
  );
  await call(trainee, '/api/studio-join-requests', {
    requestId: restoreRequest.id,
    action: 'accept',
  });
  check(
    (await db.studioMember.findUnique({ where: { id: memberId } })).userId === trainee.id,
    'Restore preserves stable identity',
  );
  await db.studioRoleGrant.updateMany({
    where: { studioId: studio.id, userId: trainee.id, role: 'trainee' },
    data: { status: 'revoked' },
  });
  await reconcileStudioRoles(db, true);
  await addMember(secondCoach);
  check(
    (await call(secondCoach, '/api/workspace')).permissions.trainee,
    'Coach can hold personal member benefits alongside staff grant',
  );
  await call(admin, '/api/studio-team', {
    action: 'status',
    userId: secondCoach.id,
    status: 'revoked',
  });
  const benefits = await call(secondCoach, '/api/workspace');
  check(
    benefits.permissions.trainee && !benefits.permissions.coach,
    'Staff revocation preserves own member benefits',
  );
  check(
    (
      await db.studioRoleGrant.findUnique({
        where: {
          studioId_userId_role: { studioId: studio.id, userId: trainee.id, role: 'trainee' },
        },
      })
    ).status === 'revoked',
    'Cutover reconciliation never resurrects revoked access',
  );
  console.log(
    `Studio role, assignment, invitation, restore and self-booking checks passed: ${checks}`,
  );
} finally {
  await db.coachAssignmentHistory.deleteMany({ where: { studioId: { in: studios } } });
  await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
}
