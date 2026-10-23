import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

/** Idempotent cutover reconciliation: absence can be backfilled; revocation is never reversed. */
export async function reconcileStudioRoles(db, apply = false) {
  const report = {
    studios: 0,
    missingAdminGrants: 0,
    missingTraineeGrants: 0,
    revokedLegacyMemberships: 0,
    missingMemberLinks: 0,
    unassignedTrainees: 0,
    missingValidTerms: 0,
    crossStudioConflicts: 0,
    legacyHosts: 0,
  };
  const studios = await db.studio.findMany({
    include: {
      roleGrants: true,
      memberships: true,
      members: { include: { primaryCoach: true, terms: true } },
    },
  });
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const users = new Map();
  for (const studio of studios) {
    report.studios++;
    const admin = studio.roleGrants.find((g) => g.userId === studio.ownerId && g.role === 'admin');
    if (!admin) {
      report.missingAdminGrants++;
      if (apply)
        await db.studioRoleGrant.upsert({
          where: {
            studioId_userId_role: { studioId: studio.id, userId: studio.ownerId, role: 'admin' },
          },
          create: { studioId: studio.id, userId: studio.ownerId, role: 'admin' },
          update: {},
        });
    }
    const identities = new Set([
      studio.ownerId,
      ...studio.roleGrants
        .filter((g) => g.status === 'active' && g.role !== 'trainee')
        .map((g) => g.userId),
    ]);
    for (const m of studio.memberships) {
      const grant = studio.roleGrants.find((g) => g.userId === m.userId && g.role === 'trainee');
      if (grant && grant.status !== 'active') {
        report.revokedLegacyMemberships++;
        continue;
      }
      identities.add(m.userId);
      if (!grant) {
        report.missingTraineeGrants++;
        if (apply)
          await db.studioRoleGrant.upsert({
            where: {
              studioId_userId_role: { studioId: studio.id, userId: m.userId, role: 'trainee' },
            },
            create: {
              studioId: studio.id,
              userId: m.userId,
              role: 'trainee',
              grantedAt: m.createdAt,
            },
            update: {},
          });
      }
      const member = studio.members.find((r) => r.userId === m.userId);
      if (!member) {
        report.missingMemberLinks++;
        continue;
      }
      if (!member.primaryCoach) report.unassignedTrainees++;
      if (
        member.status !== 'active' ||
        !member.terms.some((t) => t.status === 'active' && t.startsOn <= date && t.endsOn >= date)
      )
        report.missingValidTerms++;
    }
    for (const identity of identities) {
      const seen = users.get(identity);
      if (seen && seen !== studio.id) report.crossStudioConflicts++;
      else users.set(identity, studio.id);
    }
    for (const model of ['classSession', 'studioClass']) {
      report.legacyHosts += await db[model].count({ where: { studioId: studio.id, hostId: null } });
      if (apply)
        await db[model].updateMany({
          where: { studioId: studio.id, hostId: null },
          data: { hostId: studio.ownerId },
        });
    }
    if (apply)
      await db.workoutPlan.updateMany({
        where: { studioId: studio.id, createdById: null },
        data: { createdById: studio.ownerId },
      });
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.loadEnvFile('.env');
  const db = new PrismaClient();
  try {
    console.log(
      JSON.stringify(await reconcileStudioRoles(db, process.argv.includes('--apply')), null, 2),
    );
  } finally {
    await db.$disconnect();
  }
}
