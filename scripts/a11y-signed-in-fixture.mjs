import { randomBytes, randomUUID } from 'node:crypto';
import { provisionTestAdmin } from './local-studio-fixture.mjs';

/**
 * Disposable signed-in accounts for the accessibility gate: a studio owner (admin), an
 * accepted coach with an assigned trainee, and a live class hosted by that coach. Local
 * SQLite and example.test accounts only; every row is removed by `cleanup`.
 */
export async function createSignedInFixture(db, base) {
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
    throw new Error('Signed-in accessibility fixtures run only against a local test server.');
  if (!process.env.DATABASE_URL?.startsWith('file:'))
    throw new Error('Signed-in accessibility fixtures need a disposable local SQLite database.');
  const key = randomUUID(),
    users = [],
    studios = [];
  async function call(actor, path, body, accepted = [200]) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        'x-forwarded-for': actor.ip,
        ...(actor.cookie ? { Cookie: actor.cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) actor.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    const data = await response.json().catch(() => null);
    if (!accepted.includes(response.status))
      throw new Error(`${path} returned ${response.status}: ${JSON.stringify(data)}`);
    return data;
  }
  async function account(name, studioName) {
    const actor = {
      name,
      ip: `2001:db8:${randomBytes(2).toString('hex')}::1`,
      email: `a11y-${name.toLowerCase()}-${key}@example.test`,
    };
    const result = await call(actor, '/api/auth/sign-up/email', {
      name,
      email: actor.email,
      password: randomBytes(24).toString('base64url'),
    });
    actor.id = result.user.id;
    users.push(actor.id);
    await db.user.update({ where: { id: actor.id }, data: { emailVerified: true } });
    await call(actor, '/api/command', {
      action: 'onboard',
      name,
      role: 'trainee',
      adult: true,
      ...(studioName ? { studioName } : {}),
    });
    return actor;
  }
  const cleanup = async () => {
    await db.coachAssignmentHistory.deleteMany({ where: { studioId: { in: studios } } });
    await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  };
  try {
    const owner = await account('Owner'),
      coach = await account('Coach'),
      trainee = await account('Trainee');
    const studio = await provisionTestAdmin(db, owner.id, 'Accessibility studio');
    studios.push(studio.id);
    // Coach role comes only from an accepted team request; delivery may fail locally.
    await call(owner, '/api/studio-team', { action: 'invite', email: coach.email }, [200, 502]);
    const request = (await call(coach, '/api/studio-team/requests')).requests[0];
    await call(coach, '/api/studio-team/requests', { requestId: request.id, action: 'accept' });
    const invite = await call(owner, '/api/command', { action: 'invite', email: trainee.email });
    await call(trainee, '/api/command', { action: 'acceptInvite', code: invite.code });
    const member = await db.studioMember.findFirstOrThrow({
      where: { studioId: studio.id, userId: trainee.id },
    });
    const today = new Date().toISOString().slice(0, 10);
    const offer = await db.membershipOffer.create({
      data: {
        studioId: studio.id,
        name: 'Accessibility fixture',
        pricePaise: 0,
        durationDays: 730,
      },
    });
    await db.memberTerm.create({
      data: {
        studioId: studio.id,
        memberId: member.id,
        offerId: offer.id,
        planName: offer.name,
        feePaise: 0,
        startsOn: today,
        endsOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      },
    });
    await call(owner, '/api/studio-team', {
      action: 'assign',
      memberId: member.id,
      coachId: coach.id,
    });
    const live = await call(coach, '/api/command', {
      action: 'createClass',
      title: 'Accessibility live class',
      startsAt: new Date(Date.now() + 5 * 60000).toISOString(),
      duration: 45,
      capacity: 8,
      participantIds: [trainee.id],
    });
    await call(coach, '/api/command', { action: 'classControl', id: live.id, control: 'start' });
    return { owner, coach, trainee, classTitle: 'Accessibility live class', cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Playwright cookies for an actor signed in through the fixture's fetch calls. */
export function browserCookies(actor, base) {
  return actor.cookie.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: base };
  });
}
