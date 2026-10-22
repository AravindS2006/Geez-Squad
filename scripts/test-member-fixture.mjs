// Used only by local load/RTC rehearsals; production entitlement has no bypass.
export async function grantLocalTestTerm(db, studioId, userId) {
  if (!process.env.DATABASE_URL?.startsWith('file:')) throw new Error('Local fixture only.');
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email.endsWith('@example.test'))
    throw new Error('Disposable fixture account required.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await db.membership.upsert({
    where: { studioId_userId: { studioId, userId } },
    create: { studioId, userId },
    update: {},
  });
  await db.user.update({ where: { id: userId }, data: { role: 'trainee' } });
  const member = await db.studioMember.upsert({
    where: { studioId_userId: { studioId, userId } },
    create: { studioId, userId, name: user.name, email: user.email, joinedOn: today },
    update: {},
  });
  const offer = await db.membershipOffer.upsert({
    where: { id: `fixture-${studioId}` },
    create: {
      id: `fixture-${studioId}`,
      studioId,
      name: 'Local test entitlement',
      pricePaise: 0,
      durationDays: 730,
    },
    update: {},
  });
  await db.memberTerm.create({
    data: {
      studioId,
      memberId: member.id,
      offerId: offer.id,
      planName: offer.name,
      feePaise: 0,
      startsOn: today,
      endsOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    },
  });
}
