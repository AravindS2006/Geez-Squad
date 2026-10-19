import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, safeError } from '@/lib/security';
export async function GET() {
  try {
    const user = await requireUser();
    // A matching email alone never grants access: the account must also belong to this studio.
    const rows = await db.studioMember.findMany({
      where: {
        email: user.email.toLowerCase(),
        studio: { memberships: { some: { userId: user.id } } },
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
