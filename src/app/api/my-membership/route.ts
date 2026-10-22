import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, safeError } from '@/lib/security';
async function handleGET() {
  try {
    const user = await requireUser();
    // Stable account ownership survives contact-email edits and membership expiry.
    const rows = await db.studioMember.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        status: true,
        studio: { select: { name: true, phone: true } },
        terms: {
          orderBy: { endsOn: 'desc' },
          select: {
            id: true,
            planName: true,
            feePaise: true,
            startsOn: true,
            endsOn: true,
            status: true,
            payments: { select: { amountPaise: true } },
          },
        },
        attendance: { orderBy: { date: 'desc' }, take: 10, select: { date: true } },
      },
    });
    return NextResponse.json(
      { memberships: rows },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/my-membership', handleGET);
