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
async function account(name, fixedEmail) {
  const actor = { ip: `2001:db8:${randomBytes(2).toString('hex')}::1`, cookie: '' };
  ips.push(actor.ip);
  const email = fixedEmail ?? `${name}-${prefix}@example.test`;
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

  // Operator-approved studio creation (PLATFORM_OPERATOR_EMAILS from the runner).
  const operatorEmail = 'platform-operator@example.test';
  await db.user.deleteMany({ where: { email: operatorEmail } });
  const operator = await account('operator', operatorEmail),
    founder = await account('founder'),
    outsider = await account('outsider'),
    deputy = await account('deputy');
  const requests = (actor, body, expected) =>
    request(actor, '/api/studio-requests', body, expected);
  const studioRequest = {
    action: 'submit',
    name: 'Founder studio',
    contactPhone: '+91 90000 00000',
  };
  // An unverified address never requests or reviews, even when sign-in does not require it.
  await requests(founder, studioRequest, 403);
  await db.user.update({ where: { id: founder.id }, data: { emailVerified: true } });
  const submitted = await requests(founder, studioRequest);
  await requests(founder, studioRequest, 409);
  assert.equal((await requests(founder)).operator, false);
  const approve = { action: 'approve', requestId: submitted.id };
  await requests(outsider, approve, 403);
  await requests(operator, approve, 403);
  await db.user.update({ where: { id: operator.id }, data: { emailVerified: true } });
  assert.ok((await requests(operator)).pending.some((r) => r.id === submitted.id));
  // Double-click: both calls succeed and exactly one studio exists.
  const [approved, again] = await Promise.all([
    requests(operator, approve),
    requests(operator, approve),
  ]);
  const created = await db.studio.findMany({ where: { ownerId: founder.id } });
  assert.equal(created.length, 1, 'double approval creates one studio');
  assert.ok([approved.studioId, again.studioId].every((id) => id === created[0].id));
  assert.equal(
    await db.studioRoleGrant.count({
      where: { studioId: created[0].id, userId: founder.id, role: 'admin', status: 'active' },
    }),
    1,
  );
  assert.equal(
    await db.auditEvent.count({ where: { action: 'studio.created', targetId: created[0].id } }),
    1,
  );
  await requests(operator, { action: 'reject', requestId: submitted.id }, 409);
  checks += 4;
  const founderStudio = created[0];
  const founderBlocked = await del(
    founder,
    { action: 'delete', confirm: 'DELETE', password: founder.password },
    409,
  );
  assert.equal(founderBlocked.code, 'STUDIO_OWNER');
  checks++;

  // Ownership transfer: same-studio people only, re-authenticated, audited.
  await db.studioRoleGrant.create({
    data: { studioId: founderStudio.id, userId: deputy.id, role: 'coach' },
  });
  const ownership = (actor, body, expected) =>
    request(actor, '/api/studio-ownership', body, expected);
  const transfer = { action: 'transfer', confirm: 'TRANSFER', password: founder.password };
  const view = await ownership(founder);
  assert.deepEqual(
    view.candidates.map((c) => c.id),
    [deputy.id],
  );
  assert.equal((await ownership(outsider)).owner, false);
  await ownership(founder, { ...transfer, userId: admin.id }, 404); // another studio's owner
  await ownership(founder, { ...transfer, userId: outsider.id }, 404); // no access here
  await ownership(founder, { ...transfer, userId: deputy.id, password: 'wrong-password-x' }, 403);
  await ownership(founder, { ...transfer, userId: deputy.id, confirm: 'transfer' }, 400);
  await ownership(outsider, { ...transfer, userId: deputy.id, password: outsider.password }, 404);
  await ownership(founder, { ...transfer, userId: deputy.id });
  assert.equal(
    (await db.studio.findUniqueOrThrow({ where: { id: founderStudio.id } })).ownerId,
    deputy.id,
  );
  checks += 2;
  // The former owner is now an admin and can erase their account.
  await del(founder, { action: 'delete', confirm: 'DELETE', password: founder.password });
  assert.ok(await db.studio.findUnique({ where: { id: founderStudio.id } }), 'studio survives');
  checks++;

  // Closure: ends live classes, cancels scheduled ones, revokes everyone.
  const scheduledClass = await db.classSession.create({
    data: {
      studioId: founderStudio.id,
      title: 'Closing soon',
      startsAt: new Date(Date.now() + 86400000),
    },
  });
  const liveClass = await db.classSession.create({
    data: {
      studioId: founderStudio.id,
      title: 'Live at closure',
      startsAt: new Date(),
      status: 'live',
      startedAt: new Date(),
    },
  });
  const close = { action: 'close', confirm: 'CLOSE', password: deputy.password };
  await ownership(outsider, { ...close, password: outsider.password }, 404);
  await ownership(deputy, { ...close, confirm: 'close' }, 400);
  const closed = await ownership(deputy, close);
  assert.equal(closed.repeated, false);
  const closedRow = await db.studio.findUniqueOrThrow({ where: { id: founderStudio.id } });
  assert.equal(closedRow.status, 'closed');
  assert.equal(
    (await db.classSession.findUniqueOrThrow({ where: { id: scheduledClass.id } })).status,
    'cancelled',
  );
  assert.equal(
    (await db.classSession.findUniqueOrThrow({ where: { id: liveClass.id } })).status,
    'completed',
  );
  assert.equal(
    await db.studioRoleGrant.count({ where: { studioId: founderStudio.id, status: 'active' } }),
    0,
  );
  assert.equal((await request(deputy, '/api/workspace')).studio, null, 'owner loses access');
  assert.equal((await ownership(deputy, close)).repeated, true);
  checks += 5;
  // After closure the owner can erase their account; the studio's records stay.
  await del(deputy, { action: 'delete', confirm: 'DELETE', password: deputy.password });
  const retained = await db.studio.findUniqueOrThrow({ where: { id: founderStudio.id } });
  ids.push(retained.ownerId);
  assert.notEqual(retained.ownerId, deputy.id);
  assert.equal(await db.account.count({ where: { userId: retained.ownerId } }), 0);
  assert.equal(await db.classSession.count({ where: { studioId: founderStudio.id } }), 2);
  checks += 2;
  console.log(
    `PASS: ${checks} account lifecycle checks (weekly class series, deletion guards, coach and member erasure, studio request, transfer and closure).`,
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
