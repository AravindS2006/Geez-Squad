import { loggedRoute } from '@/lib/request-log';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeError } from '@/lib/security';
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
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/retention', handleGET);
