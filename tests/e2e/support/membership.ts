import type { PrismaClient } from '@prisma/client';
/** Explicitly seed entitlement for disposable local accounts; never bypass application gates. */
export async function grantStudioTerm(db: PrismaClient, identity: string) {
  if (!process.env.DATABASE_URL?.startsWith('file:')) throw new Error('Local fixture only.');
  const user = await db.user.findFirstOrThrow({
    where: { OR: [{ id: identity }, { email: identity }] },
  });
  if (!user.email.endsWith('@example.test'))
    throw new Error('Disposable fixture account required.');
  const accepted = await db.membership.findFirstOrThrow({ where: { userId: user.id } });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const member = await db.studioMember.upsert({
    where: { studioId_userId: { studioId: accepted.studioId, userId: user.id } },
    create: {
      studioId: accepted.studioId,
      userId: user.id,
      name: user.name,
      email: user.email,
      goal: user.goal,
      joinedOn: today,
    },
    update: {},
  });
  if (await db.memberTerm.count({ where: { memberId: member.id } })) return;
  const offer = await db.membershipOffer.upsert({
    where: { id: `test-${accepted.studioId}` },
    create: {
      id: `test-${accepted.studioId}`,
      studioId: accepted.studioId,
      name: 'Local acceptance fixture',
      durationDays: 730,
      pricePaise: 0,
    },
    update: {},
  });
  await db.memberTerm.create({
    data: {
      studioId: accepted.studioId,
      memberId: member.id,
      offerId: offer.id,
      planName: offer.name,
      feePaise: 0,
      startsOn: today,
      endsOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    },
  });
}
