import { loggedRoute } from '@/lib/request-log';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeError } from '@/lib/security';
import { completeAbandonedClasses } from '@/lib/class-completion';
import {
  auditRetentionDays,
  PRUNE_TIME_BUDGET_MS,
  pruneInBatches,
  retentionCutoff,
  WEBHOOK_EVENT_RETENTION_DAYS,
} from '@/lib/retention-policy';

/** Seconds; the batched pruning below stops after PRUNE_TIME_BUDGET_MS. */
export const maxDuration = 60;

const expired = (cutoff: Date) => ({
  where: { createdAt: { lt: cutoff } },
  select: { id: true },
  orderBy: { createdAt: 'asc' as const },
});
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

async function handleGET(request: Request) {
  try {
    const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
    const supplied = request.headers.get('authorization') || '';
    if (
      !process.env.CRON_SECRET ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const now = new Date();
    await db.$transaction([
      db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.invitation.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.rateLimit.deleteMany({ where: { lastRequest: { lt: BigInt(Date.now() - 86400000) } } }),
      db.metric.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 7 * 86400000) } } }),
      db.message.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } }),
    ]);
    // Audit and webhook tables can be large: pruned in bounded batches outside the transaction.
    const limits = { deadline: Date.now() + PRUNE_TIME_BUDGET_MS };
    const webhookCutoff = retentionCutoff(now, WEBHOOK_EVENT_RETENTION_DAYS);
    const webhookEvents = await pruneInBatches(
      async (take) => ids(await db.webhookEvent.findMany({ ...expired(webhookCutoff), take })),
      async (batch) => (await db.webhookEvent.deleteMany({ where: { id: { in: batch } } })).count,
      limits,
    );
    const auditCutoff = retentionCutoff(now, auditRetentionDays(process.env.AUDIT_RETENTION_DAYS));
    const auditEvents = await pruneInBatches(
      async (take) => ids(await db.auditEvent.findMany({ ...expired(auditCutoff), take })),
      async (batch) => (await db.auditEvent.deleteMany({ where: { id: { in: batch } } })).count,
      limits,
    );
    // Backstop for live classes nobody is polling: coach gone or past the hard maximum.
    const classes = await completeAbandonedClasses(now);
    return NextResponse.json({ ok: true, classes, webhookEvents, auditEvents });
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/retention', handleGET);
