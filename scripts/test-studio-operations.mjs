import { provisionTestAdmin } from './local-studio-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
process.loadEnvFile('.env');
const db = new PrismaClient(),
  origin = 'http://localhost:3000',
  key = randomUUID();
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const next = new Date(`${today}T12:00:00Z`);
next.setUTCDate(next.getUTCDate() + 1);
const tomorrow = next.toISOString().slice(0, 10);
const ids = [],
  agents = [];
let checks = 0;
function check(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks++;
}
async function agent(name, role) {
  const session = {
    cookie: '',
    ip: `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`,
  };
  session.call = async (path, body) => {
    const response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-forwarded-for': session.ip,
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) session.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    return { status: response.status, data: await response.json() };
  };
  const signup = await session.call('/api/auth/sign-up/email', {
    name,
    email: `studio-${role}-${agents.length}-${key}@example.test`,
    password: randomBytes(24).toString('base64url'),
  });
  check(signup.status, 200, 'signup');
  ids.push(signup.data.user.id);
  session.email = signup.data.user.email;
  check(
    (await session.call('/api/command', { action: 'onboard', role: 'trainee', name, adult: true }))
      .status,
    200,
    'onboarding',
  );
  if (role === 'coach') await provisionTestAdmin(db, signup.data.user.id);
  agents.push(session);
  return session;
}
try {
  check((await fetch(origin + '/api/studio-operations')).status, 401, 'anonymous cannot read');
  const a = await agent('Studio Test Owner', 'coach'),
    b = await agent('Other Studio Owner', 'coach'),
    member = await agent('Studio Test Member', 'trainee');
  check(
    (await member.call('/api/studio-operations')).status,
    403,
    'member cannot read owner operations',
  );
  const post = (c) => a.call('/api/studio-operations', c);
  const plan = await post({
    action: 'offer',
    name: 'Test monthly',
    description: 'Integration plan',
    durationDays: 30,
    pricePaise: 250000,
    active: true,
  });
  check(plan.status, 200, 'plan creation');
  const createMember = async (name, email) => {
    const r = await post({
      action: 'member',
      name,
      email,
      phone: '',
      goal: 'Strength',
      joinedOn: today,
      status: 'active',
    });
    check(r.status, 200, 'member creation');
    return r.data.id;
  };
  const first = await createMember('Studio Test Member', member.email),
    second = await createMember('Second Studio Member', `second-${key}@example.test`);
  check(
    (
      await post({
        action: 'member',
        name: 'Duplicate Member',
        email: member.email.toUpperCase(),
        phone: '',
        goal: '',
        joinedOn: today,
        status: 'active',
      })
    ).status,
    409,
    'duplicate email rejected',
  );
  const term = await post({
    action: 'term',
    memberId: first,
    offerId: plan.data.id,
    startsOn: today,
  });
  check(term.status, 200, 'membership assigned');
  check(
    (await post({ action: 'term', memberId: first, offerId: plan.data.id, startsOn: today }))
      .status,
    409,
    'overlap rejected',
  );
  check(
    (
      await b.call('/api/studio-operations', {
        action: 'term',
        memberId: first,
        offerId: plan.data.id,
        startsOn: today,
      })
    ).status,
    400,
    'cross-studio membership denied',
  );
  check(
    (
      await b.call('/api/studio-operations', {
        action: 'member',
        id: first,
        name: 'Malicious edit',
        email: '',
        phone: '',
        goal: '',
        joinedOn: today,
        status: 'active',
      })
    ).status,
    404,
    'cross-studio edit denied',
  );
  check(
    (await post({ action: 'attendance', memberId: second, date: today })).status,
    409,
    'unpaid unassigned member has no attendance access',
  );
  const payment = {
    action: 'payment',
    id: randomUUID(),
    termId: term.data.id,
    amountPaise: 100000,
    paidOn: today,
    method: 'UPI',
    reference: 'Integration payment',
  };
  check((await post(payment)).status, 200, 'partial payment');
  check((await post(payment)).status, 200, 'idempotent payment replay');
  check((await post({ ...payment, amountPaise: 100001 })).status, 409, 'changed replay rejected');
  check(
    (await post({ ...payment, id: randomUUID(), amountPaise: 200000 })).status,
    409,
    'overpayment rejected',
  );
  const race = await Promise.all(
    [1, 2].map(() => post({ ...payment, id: randomUUID(), amountPaise: 150000 })),
  );
  check(
    race.filter((r) => r.status === 200).length,
    1,
    'only one simultaneous final payment accepted',
  );
  check(race.filter((r) => r.status === 409).length, 1, 'concurrent overpayment blocked');
  check(
    (await post({ action: 'cancelTerm', id: term.data.id })).status,
    409,
    'paid term cannot be cancelled',
  );
  check(
    (await post({ action: 'attendance', memberId: first, date: today })).status,
    200,
    'member check-in',
  );
  check(
    (await post({ action: 'attendance', memberId: first, date: today })).status,
    200,
    'check-in replay',
  );
  check(
    (await post({ action: 'attendance', memberId: first, date: tomorrow })).status,
    400,
    'future attendance rejected',
  );
  check(
    (await post({ action: 'term', memberId: second, offerId: plan.data.id, startsOn: today }))
      .status,
    200,
    'second membership',
  );
  const classFields = {
    action: 'studioClass',
    title: 'Test floor class',
    trainer: 'Test Coach',
    location: 'Main studio',
    startsAt: new Date(`${tomorrow}T09:00:00+05:30`).toISOString(),
    duration: 45,
    capacity: 1,
    status: 'scheduled',
  };
  const studioClass = await post(classFields);
  check(studioClass.status, 200, 'studio class scheduled');
  check(
    (
      await post({
        action: 'booking',
        classId: studioClass.data.id,
        memberId: first,
        status: 'booked',
      })
    ).status,
    200,
    'first class booking',
  );
  check(
    (
      await post({
        action: 'booking',
        classId: studioClass.data.id,
        memberId: second,
        status: 'booked',
      })
    ).status,
    409,
    'class capacity enforced',
  );
  check(
    (
      await b.call('/api/studio-operations', {
        action: 'booking',
        classId: studioClass.data.id,
        memberId: first,
        status: 'cancelled',
      })
    ).status,
    409,
    'foreign class access denied',
  );
  check(
    (
      await post({
        action: 'booking',
        classId: studioClass.data.id,
        memberId: first,
        status: 'cancelled',
      })
    ).status,
    200,
    'booking cancellation',
  );
  check(
    (
      await post({
        action: 'booking',
        classId: studioClass.data.id,
        memberId: second,
        status: 'booked',
      })
    ).status,
    200,
    'released class place can be booked',
  );
  check(
    (await post({ ...classFields, id: studioClass.data.id, status: 'completed' })).status,
    400,
    'future class cannot be completed',
  );
  const pending = await db.studioJoinRequest.findUniqueOrThrow({ where: { memberId: first } });
  check(
    (await member.call('/api/studio-join-requests', { requestId: pending.id, action: 'accept' }))
      .status,
    403,
    'unverified identity cannot claim member data',
  );
  await db.user.update({ where: { id: ids[2] }, data: { emailVerified: true } });
  const requests = await member.call('/api/studio-join-requests');
  check(requests.data.requests.length, 1, 'member sees automatically created studio request');
  check(
    (await member.call('/api/studio-join-requests', { requestId: pending.id, action: 'accept' }))
      .status,
    200,
    'member accepts in app without coaching invitation',
  );
  check(
    (await member.call('/api/studio-join-requests', { requestId: pending.id, action: 'accept' }))
      .status,
    200,
    'acceptance retry is idempotent',
  );
  const self = await member.call('/api/my-membership');
  check(self.status, 200, 'member self view');
  check(self.data.memberships.length, 1, 'self view only own membership');
  check(self.data.memberships[0].id, first, 'self membership identity');
  const snapshot = await a.call('/api/studio-operations');
  check(snapshot.status, 200, 'persisted studio data');
  check(snapshot.data.members.length, 2, 'member register persisted');
  check(snapshot.data.payments.length, 2, 'payment replay creates no duplicate');
  check(
    snapshot.data.payments.reduce((s, p) => s + p.amountPaise, 0),
    250000,
    'exact collected balance',
  );
  check(snapshot.data.attendance.length, 1, 'attendance deduplicated');
  check(
    (await b.call('/api/studio-operations')).data.members.length,
    0,
    'other studio sees no private records',
  );
  check(
    (await b.call('/api/my-membership')).data.memberships.length,
    0,
    'unlinked account has no member details',
  );
  const enquiry = await post({
    action: 'enquiry',
    name: 'Enquiry Test',
    phone: '0000000000',
    interest: 'Strength',
    source: 'Walk-in',
    stage: 'trial',
    followUpOn: tomorrow,
    note: 'Local integration fixture',
  });
  check(enquiry.status, 200, 'enquiry saved');
  check(
    (
      await post({
        action: 'staff',
        name: 'Staff Test',
        email: '',
        phone: '',
        role: 'Trainer',
        specialty: 'Strength',
        status: 'active',
      })
    ).status,
    200,
    'staff directory saved',
  );
  check(
    (
      await post({
        action: 'details',
        name: 'Studio Test',
        phone: '',
        address: 'Test address',
        hours: '6 am – 9 pm',
      })
    ).status,
    200,
    'studio profile saved',
  );
  const badOrigin = await fetch(origin + '/api/studio-operations', {
    method: 'POST',
    headers: {
      Origin: 'https://invalid.example',
      'Content-Type': 'application/json',
      Cookie: a.cookie,
    },
    body: JSON.stringify(payment),
  });
  check(badOrigin.status, 403, 'cross-origin mutation rejected');
  check(
    (await member.call('/api/export')).data.studioRecords.length,
    1,
    'personal export includes linked studio records',
  );
  check(
    (
      await post({
        action: 'member',
        id: first,
        name: 'Studio Test Member',
        email: `contact-${key}@example.test`,
        phone: '',
        goal: 'Strength',
        joinedOn: today,
        status: 'active',
      })
    ).status,
    200,
    'linked contact email can change',
  );
  check(
    (await member.call('/api/my-membership')).data.memberships[0].id,
    first,
    'contact email edit preserves account ownership',
  );
  const suspended = await post({
    action: 'member',
    id: second,
    name: 'Second Studio Member',
    email: `second-${key}@example.test`,
    phone: '',
    goal: 'Strength',
    joinedOn: today,
    status: 'paused',
  });
  check(suspended.status, 200, 'pause member');
  check(suspended.data.releasedBookings, 1, 'pause releases future booking capacity');
  const futureEmail = `studio-trainee-${agents.length}-${key}@example.test`;
  const futureMember = await createMember('Future account', futureEmail);
  const futureClient = await agent('Future account', 'trainee');
  await db.user.update({ where: { email: futureEmail }, data: { emailVerified: true } });
  let futureRequests = (await futureClient.call('/api/studio-join-requests')).data.requests;
  check(futureRequests.length, 1, 'account created later discovers existing request');
  check(
    (
      await futureClient.call('/api/studio-join-requests', {
        requestId: futureRequests[0].id,
        action: 'decline',
      })
    ).status,
    200,
    'client may decline',
  );
  check(
    (await futureClient.call('/api/my-membership')).data.memberships.length,
    0,
    'declining exposes no membership history',
  );
  check(
    (await post({ action: 'memberAccess', memberId: futureMember, operation: 'sendEmail' })).status,
    502,
    'local email mode reports delivery failure while retaining the request',
  );
  futureRequests = (await futureClient.call('/api/studio-join-requests')).data.requests;
  check(futureRequests.length, 1, 'resend restores one pending request');
  check(
    (await post({ action: 'memberAccess', memberId: futureMember, operation: 'withdraw' })).status,
    200,
    'owner can withdraw',
  );
  check(
    (
      await futureClient.call('/api/studio-join-requests', {
        requestId: futureRequests[0].id,
        action: 'accept',
      })
    ).status,
    409,
    'withdrawn request cannot be accepted',
  );
  console.log(
    `PASS: ${checks} studio operations API checks, including membership lifecycle, concurrent payments, physical class capacity, owner isolation, and member self view.`,
  );
} finally {
  for (const id of ids) {
    await db.auditEvent.deleteMany({ where: { actorId: id } });
    await db.rateLimit.deleteMany({ where: { key: { contains: `:${id}:` } } });
    await db.user.deleteMany({ where: { id } });
  }
  for (const a of agents) await db.rateLimit.deleteMany({ where: { key: { contains: a.ip } } });
  await db.$disconnect();
}
