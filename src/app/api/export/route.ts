import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, safeError, rateLimit } from '@/lib/security';
async function handleGET() {
  try {
    const user = await requireUser();
    await rateLimit(user.id, 'export', 3);
    const enrollments = await db.enrollment.findMany({
      where: { userId: user.id },
      include: { summary: true, class: { select: { title: true, startsAt: true, status: true } } },
    });
    const memberships = await db.membership.findMany({
      where: { userId: user.id },
      select: { createdAt: true, studio: { select: { name: true } } },
    });
    const studioRecords = await db.studioMember.findMany({
      where: { userId: user.id },
      select: {
        name: true,
        email: true,
        phone: true,
        goal: true,
        status: true,
        joinedOn: true,
        studio: { select: { name: true } },
        terms: {
          select: {
            planName: true,
            feePaise: true,
            startsOn: true,
            endsOn: true,
            status: true,
            payments: {
              select: { amountPaise: true, paidOn: true, method: true, reference: true },
            },
          },
        },
        attendance: { select: { date: true } },
        bookings: { select: { status: true, class: { select: { title: true, startsAt: true } } } },
      },
    });
    const [workoutSets, checkIns, assignments] = await Promise.all([
      db.workoutSet.findMany({ where: { userId: user.id }, orderBy: { endedAt: 'desc' } }),
      db.checkIn.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      db.planAssignment.findMany({
        where: { userId: user.id },
        select: { assignedAt: true, plan: { select: { name: true, blocks: true } } },
      }),
    ]);
    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        profile: {
          name: user.name,
          email: user.email,
          goal: user.goal,
          role: user.role,
          createdAt: user.createdAt,
        },
        memberships,
        studioRecords,
        workoutSets,
        checkIns,
        assignments,
        workouts: enrollments.map((e) => ({
          class: e.class,
          consentAt: e.consentAt,
          summary: e.summary,
        })),
      },
      {
        headers: {
          'Content-Disposition': 'attachment; filename="geez-squad-data.json"',
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/export', handleGET);
