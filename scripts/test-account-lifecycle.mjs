import { isDisposableTestDatabase } from './disposable-database.mjs';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { provisionTestAdmin } from './local-studio-fixture.mjs';
import { grantLocalTestTerm } from './test-member-fixture.mjs';
process.loadEnvFile('.env');
const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
if (!isDisposableTestDatabase() || !['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local disposable database/server required.');
const db = new PrismaClient(),
  ids = [],
  ips = [],
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
  ips.push(actor.ip);
  const email = `${name}-${prefix}@example.test`;
  actor.password = randomBytes(24).toString('base64url');
  await request(actor, '/api/auth/sign-up/email', {
    name: `Lifecycle ${name}`,
    email,
    password: actor.password,
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
const inTwoDays = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
try {
  const admin = await account('admin'),
    coach = await account('coach'),
    member = await account('member');
  const studio = await provisionTestAdmin(db, admin.id, 'Lifecycle studio');
  await db.studioRoleGrant.create({
    data: { studioId: studio.id, userId: coach.id, role: 'coach' },
  });
  await grantLocalTestTerm(db, studio.id, member.id);
  const ops = (body, expected) => request(admin, '/api/studio-operations', body, expected);

  // Weekly class series.
  const first = new Date(`${inTwoDays()}T07:00:00+05:30`).toISOString();
  const classFields = {
    action: 'studioClass',
    title: 'Series strength',
    trainer: 'Lifecycle Coach',
    location: 'Series room',
    startsAt: first,
    duration: 45,
    capacity: 10,
    status: 'scheduled',
  };
  const series = await ops({ ...classFields, repeatWeeks: 4 });
  assert.equal(series.ids.length, 4);
  const saved = await db.studioClass.findMany({
    where: { id: { in: series.ids } },
    orderBy: { startsAt: 'asc' },
  });
  assert.equal(saved.length, 4);
  for (const [i, row] of saved.entries())
    assert.equal(row.startsAt.getTime(), Date.parse(first) + i * 7 * 86400000);
  checks += 2;
  const week = 7 * 86400000;
  await ops({
    ...classFields,
    title: 'Blocking class',
    startsAt: new Date(Date.parse(first) + 6 * week + 15 * 60000).toISOString(),
  });
  const before = await db.studioClass.count({ where: { studioId: studio.id } });
  // Weeks 4 and 5 are free; week 6 collides, so the whole second series is rejected.
  const clash = await ops(
    {
      ...classFields,
      title: 'Overlapping series',
      startsAt: new Date(Date.parse(first) + 4 * week).toISOString(),
      repeatWeeks: 4,
    },
    409,
  );
  assert.match(clash.error, /No classes in the series were saved/);
  assert.equal(await db.studioClass.count({ where: { studioId: studio.id } }), before);
  checks += 2;
  await ops({ ...classFields, id: series.ids[1], repeatWeeks: 4 }, 400);
  await ops({ ...classFields, id: series.ids[1], status: 'cancelled' });
  assert.equal(
    await db.studioClass.count({ where: { id: { in: series.ids }, status: 'scheduled' } }),
    3,
    'cancelling one date leaves the rest of the series',
  );
  checks++;

  // Account deletion guards.
  const del = (actor, body, expected) => request(actor, '/api/account', body, expected);
  await del(member, { action: 'delete', confirm: 'delete', password: member.password }, 400);
  await del(member, { action: 'delete', confirm: 'DELETE', password: 'wrong-password-x' }, 403);
  const ownerBlocked = await del(
    admin,
    { action: 'delete', confirm: 'DELETE', password: admin.password },
    409,
  );
  assert.equal(ownerBlocked.code, 'STUDIO_OWNER');
  assert.ok(await db.studio.findUnique({ where: { id: studio.id } }), 'studio survives');
  checks += 2;
  await db.billingSubscription.create({
    data: { userId: member.id, customerId: `cus_${prefix}`, status: 'active' },
  });
  await del(member, { action: 'delete', confirm: 'DELETE', password: member.password }, 409);
  await db.billingSubscription.update({
    where: { userId: member.id },
    data: { status: 'canceled' },
  });

  // Coach deletion keeps a history record and releases hosted classes to the owner.
  const record = await db.studioMember.findUniqueOrThrow({
    where: { studioId_userId: { studioId: studio.id, userId: member.id } },
  });
  await db.primaryCoachAssignment.create({ data: { memberId: record.id, coachId: coach.id } });
  await db.studioClass.update({ where: { id: series.ids[0] }, data: { hostId: coach.id } });
  await del(coach, { action: 'delete', confirm: 'DELETE', password: coach.password });
  assert.equal(await db.user.count({ where: { id: coach.id } }), 0);
  assert.equal(
    await db.coachAssignmentHistory.count({ where: { memberId: record.id, coachId: coach.id } }),
    1,
  );
  assert.equal(
    (await db.studioClass.findUniqueOrThrow({ where: { id: series.ids[0] } })).hostId,
    null,
  );
  checks += 3;
  await request(coach, '/api/workspace', undefined, 401);

  // Member deletion erases personal data but leaves the studio's member register.
  await db.checkIn.create({
    data: { userId: member.id, energy: 3, soreness: 2, note: 'lifecycle' },
  });
  await del(member, { action: 'delete', confirm: 'DELETE', password: member.password });
  assert.equal(await db.checkIn.count({ where: { userId: member.id } }), 0);
  assert.equal(await db.session.count({ where: { userId: member.id } }), 0);
  const kept = await db.studioMember.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(kept.userId, null, 'studio member record is unlinked, not erased');
  assert.ok(await db.memberTerm.count({ where: { memberId: record.id } }), 'terms retained');
  assert.equal(
    await db.auditEvent.count({ where: { action: 'account.deleted', targetId: member.id } }),
    1,
  );
  checks += 5;
  await request(member, '/api/workspace', undefined, 401);
  console.log(
    `PASS: ${checks} account lifecycle checks (weekly class series, deletion guards, coach and member erasure).`,
  );
} finally {
  for (const id of ids) {
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: id }, { targetId: id }] } });
    await db.rateLimit.deleteMany({ where: { key: { contains: `:${id}:` } } });
    await db.coachAssignmentHistory.deleteMany({ where: { coachId: id } });
    await db.user.deleteMany({ where: { id } });
  }
  for (const ip of ips) await db.rateLimit.deleteMany({ where: { key: { contains: ip } } });
  await db.$disconnect();
}
