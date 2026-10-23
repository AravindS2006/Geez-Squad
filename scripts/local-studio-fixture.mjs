/** Explicit local fixtures, never a public onboarding privilege bypass. */
export async function provisionTestAdmin(db, identity, name = 'Local test studio') {
  if (!process.env.DATABASE_URL?.startsWith('file:')) throw new Error('Local SQLite fixture only.');
  const user = await db.user.findFirstOrThrow({
    where: { OR: [{ id: identity }, { email: identity }] },
  });
  if (!user.email.endsWith('@example.test'))
    throw new Error('Disposable fixture account required.');
  const studio = await db.studio.upsert({
    where: { ownerId: user.id },
    create: { ownerId: user.id, name },
    update: {},
  });
  await db.studioRoleGrant.upsert({
    where: { studioId_userId_role: { studioId: studio.id, userId: user.id, role: 'admin' } },
    create: { studioId: studio.id, userId: user.id, role: 'admin' },
    update: {},
  });
  return studio;
}
