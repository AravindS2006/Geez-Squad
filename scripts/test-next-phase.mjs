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
  throw new Error('Local disposable database/server required.');
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
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
async function account(name) {
  const actor = { ip: `2001:db8:${randomBytes(2).toString('hex')}::1`, cookie: '' };
  const email = `${name}-${prefix}@example.test`;
  await request(actor, '/api/auth/sign-up/email', {
    name: `Next ${name}`,
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
  const admin = await account('admin'),
    member = await account('member'),
    coach = await account('coach'),
    stranger = await account('stranger');
  const studio = await provisionTestAdmin(db, admin.id);
  await grantLocalTestTerm(db, studio.id, member.id);
  await db.studioRoleGrant.create({
    data: { studioId: studio.id, userId: coach.id, role: 'coach' },
  });
  const profile = await db.studioMember.findFirstOrThrow({
    where: { studioId: studio.id, userId: member.id },
  });
  await db.primaryCoachAssignment.create({ data: { memberId: profile.id, coachId: coach.id } });
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const path = `/api/nutrition?userId=${member.id}&date=${day}`;
  const targets = {
    calories: 2200,
    protein: 100,
    waterMl: 2000,
    preferences: 'Member-entered preferences',
    guidance: 'Agreed targets',
  };
  const entry = {
    id: randomUUID(),
    date: day,
    meal: 'Breakfast',
    description: 'Fixture oats',
    calories: 350,
    protein: 12.5,
    carbs: null,
    fat: null,
    waterMl: 250,
  };
  await request(stranger, path, undefined, 404);
  await request(admin, path, undefined, 404);
  await request(coach, path, undefined, 404);
  await request(member, '/api/nutrition', { action: 'entry', entry });
  await request(member, '/api/nutrition', { action: 'entry', entry });
  assert.equal(await db.nutritionEntry.count({ where: { userId: member.id } }), 1);
  checks++;
  await request(member, '/api/nutrition', {
    action: 'targets',
    userId: member.id,
    profile: targets,
  });
  await request(member, '/api/nutrition', { action: 'sharing', shareWithCoach: true });
  assert.equal((await request(coach, path)).entries[0].protein, 12.5);
  checks++;
  await request(admin, path);
  await request(stranger, path, undefined, 404);
  await request(coach, '/api/nutrition', {
    action: 'targets',
    userId: member.id,
    profile: { ...targets, protein: 110 },
  });
  await request(
    stranger,
    '/api/nutrition',
    { action: 'targets', userId: member.id, profile: targets },
    404,
  );
  await request(
    stranger,
    '/api/nutrition',
    { action: 'entry', entry: { ...entry, description: 'Foreign overwrite' } },
    404,
  );
  await request(stranger, '/api/nutrition', { action: 'remove', id: entry.id });
  assert.equal((await request(member, path)).entries[0].description, entry.description);
  checks++;
  await request(
    member,
    '/api/nutrition',
    { action: 'entry', entry: { ...entry, protein: -1 } },
    400,
  );
  await request(member, `/api/nutrition?date=2026-02-30`, undefined, 400);
  await request(member, '/api/nutrition', { action: 'sharing', shareWithCoach: false });
  await request(coach, path, undefined, 404);
  await request(
    coach,
    '/api/nutrition',
    { action: 'targets', userId: member.id, profile: targets },
    404,
  );
  await request(member, '/api/nutrition', { action: 'sharing', shareWithCoach: true });
  await db.primaryCoachAssignment.delete({ where: { memberId: profile.id } });
  await request(coach, path, undefined, 404);
  const exported = await request(member, '/api/export');
  assert.equal(exported.nutritionEntries[0].description, entry.description);
  checks++;
  await request(member, '/api/nutrition', { action: 'remove', id: entry.id });
  assert.equal((await request(member, path)).entries.length, 0);
  checks++;
  await request(admin, '/api/studio-operations', {
    action: 'attendance',
    memberId: profile.id,
    date: day,
  });
  await request(
    stranger,
    '/api/studio-operations',
    {
      action: 'removeAttendance',
      memberId: profile.id,
      date: day,
      reason: 'Unauthorized correction',
    },
    403,
  );
  await request(admin, '/api/studio-operations', {
    action: 'removeAttendance',
    memberId: profile.id,
    date: day,
    reason: 'Fixture recorded in error',
  });
  assert.equal(await db.studioAttendance.count({ where: { memberId: profile.id } }), 0);
  assert.equal(
    (
      await db.auditEvent.findFirstOrThrow({
        where: { actorId: admin.id, action: 'attendance.correction' },
      })
    ).detailsJson.reason,
    'Fixture recorded in error',
  );
  checks += 2;
  const startsAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const scheduled = {
    action: 'studioClass',
    title: 'Fixture studio class',
    trainer: 'Next admin',
    hostId: admin.id,
    location: 'Main studio',
    startsAt,
    duration: 45,
    capacity: 12,
    status: 'scheduled',
  };
  await request(admin, '/api/studio-operations', scheduled);
  await request(
    admin,
    '/api/command',
    {
      action: 'createClass',
      title: 'Conflict online class',
      hostId: admin.id,
      startsAt,
      duration: 30,
      capacity: 2,
      participantIds: [member.id],
    },
    409,
  );
  await request(admin, '/api/studio-operations', { ...scheduled, location: 'Other studio' }, 409);
  await request(
    admin,
    '/api/studio-operations',
    { ...scheduled, trainer: 'Next coach', hostId: coach.id },
    409,
  );
  await request(admin, '/api/studio-operations', {
    ...scheduled,
    trainer: 'Next coach',
    hostId: coach.id,
    location: 'Other studio',
  });
  await request(admin, '/api/studio-operations', {
    ...scheduled,
    startsAt: new Date(Date.parse(startsAt) + 45 * 60000).toISOString(),
  });
  await db.studioRoleGrant.updateMany({ where: { userId: coach.id }, data: { status: 'revoked' } });
  await request(coach, path, undefined, 404);
  console.log(
    `PASS: ${checks} nutrition privacy, durable journal, corrections, membership and trainer/class conflict checks.`,
  );
} finally {
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
