import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorContext, logEvent } from '@/lib/logger';
import { requestContext } from '@/lib/request-log';
async function handleGET() {
  try {
    // Validate the schema the app actually needs, without reading personal records.
    // A reachable database with unapplied migrations must not report healthy.
    await db.$queryRaw`
      SELECT s."address", s."hours", s."phone", m."joinedOn", o."pricePaise",
        t."endsOn", p."amountPaise", a."date", e."followUpOn", f."role",
        c."startsAt", b."status", m."userId", j."status"
      FROM "Studio" s, "StudioMember" m, "MembershipOffer" o, "MemberTerm" t,
        "StudioPayment" p, "StudioAttendance" a, "StudioEnquiry" e,
        "StudioStaff" f, "StudioClass" c, "StudioBooking" b, "StudioJoinRequest" j
      WHERE 1 = 0
    `;
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logEvent('error', 'schema_readiness_failed', {
      ...requestContext.getStore(),
      ...errorContext(error),
    });
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const GET = loggedRoute('/api/health', handleGET);
