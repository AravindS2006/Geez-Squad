import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
export async function GET() {
  try {
    // Validate the schema the app actually needs, without reading personal records.
    // A reachable database with unapplied migrations must not report healthy.
    await db.$queryRaw`
      SELECT s."address", s."hours", s."phone", m."joinedOn", o."pricePaise",
        t."endsOn", p."amountPaise", a."date", e."followUpOn", f."role",
        c."startsAt", b."status"
      FROM "Studio" s, "StudioMember" m, "MembershipOffer" o, "MemberTerm" t,
        "StudioPayment" p, "StudioAttendance" a, "StudioEnquiry" e,
        "StudioStaff" f, "StudioClass" c, "StudioBooking" b
      WHERE 1 = 0
    `;
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
