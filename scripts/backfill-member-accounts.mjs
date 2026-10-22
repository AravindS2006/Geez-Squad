import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function backfillMemberAccounts(db, apply = false) {
  const memberships = await db.membership.findMany({ include: { user: true } });
  const report = {
    acceptedClients: memberships.length,
    alreadyLinked: 0,
    toLink: 0,
    toCreate: 0,
    missingActiveTerms: 0,
    conflicts: [],
  };
  const decisions = [];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  for (const membership of memberships) {
    const existing = await db.studioMember.findMany({
      where: {
        studioId: membership.studioId,
        OR: [{ userId: membership.userId }, { email: membership.user.email.toLowerCase() }],
      },
      include: { terms: true },
    });
    if (
      memberships.some(
        (m) => m.userId === membership.userId && m.studioId !== membership.studioId,
      ) ||
      existing.length > 1 ||
      existing.some((m) => m.userId && m.userId !== membership.userId)
    ) {
      report.conflicts.push(membership.id);
      continue;
    }
    const member = existing[0];
    if (
      !member ||
      member.status !== 'active' ||
      !member.terms.some((t) => t.status === 'active' && t.startsOn <= today && t.endsOn >= today)
    )
      report.missingActiveTerms++;
    if (member?.userId === membership.userId) report.alreadyLinked++;
    else {
      if (member) report.toLink++;
      else report.toCreate++;
      decisions.push({ membership, member });
    }
  }
  const pendingMembers = await db.studioMember.findMany({
    where: { userId: null, email: { not: '' }, status: { not: 'archived' }, joinRequest: null },
  });
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'preflight',
      ...report,
      requestsToCreate: pendingMembers.length,
    }),
  );
  if (report.conflicts.length) {
    return report;
  } else if (apply)
    for (const { membership, member } of decisions) {
      await db.$transaction(
        async (tx) => {
          if (member)
            await tx.studioMember.update({
              where: { id: member.id, userId: null, email: membership.user.email.toLowerCase() },
              data: { userId: membership.userId },
            });
          else
            await tx.studioMember.create({
              data: {
                id: randomUUID(),
                studioId: membership.studioId,
                userId: membership.userId,
                name: membership.user.name,
                email: membership.user.email.toLowerCase(),
                goal: membership.user.goal,
                joinedOn: new Intl.DateTimeFormat('en-CA', {
                  timeZone: 'Asia/Kolkata',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(membership.createdAt),
              },
            });
          await tx.studioJoinRequest.updateMany({
            where: { member: { studioId: membership.studioId, userId: membership.userId } },
            data: { status: 'accepted' },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    }
  if (apply && !report.conflicts.length)
    for (const member of pendingMembers) {
      const current = await db.studioMember.findFirst({
        where: { id: member.id, userId: null, email: member.email, status: { not: 'archived' } },
      });
      if (current)
        await db.studioJoinRequest.upsert({
          where: { memberId: member.id },
          create: { memberId: member.id, email: member.email },
          update: {},
        });
    }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.DATABASE_PROVIDER !== 'postgresql') process.loadEnvFile('.env');
  const db = new PrismaClient();
  try {
    const report = await backfillMemberAccounts(db, process.argv.includes('--apply'));
    if (report.conflicts.length) process.exitCode = 1;
  } catch {
    console.error(
      'Member-account backfill failed. No account credentials were changed. Check schema readiness and rerun preflight.',
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
