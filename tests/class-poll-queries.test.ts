/**
 * Real SQLite + real Better Auth measurement of the live-class poll
 * (GET /api/classes/[id]). It counts the SQL statements Prisma sends per poll and pins
 * the authorization outcome for every studio role, so query cuts cannot silently
 * change who sees what.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => {
  const file = `${process.env.TEMP || process.env.TMP || '.'}/geez-class-poll-${process.pid}-${Date.now()}.db`;
  process.env.BETTER_AUTH_SECRET = 'class-poll-query-budget-test-secret-0001';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  process.env.EMAIL_DELIVERY = 'test';
  process.env.LIVEKIT_URL = '';
  process.env.LOG_LEVEL = 'error';
  return {
    file,
    url: `file:${file.replaceAll('\\', '/')}`,
    cookie: '',
    queries: [] as string[],
    counting: false,
    deferred: [] as (() => unknown)[],
  };
});
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: fx.cookie }),
  cookies: async () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    fx.deferred.push(task);
  },
}));
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({
    datasourceUrl: fx.url,
    log: [{ emit: 'event', level: 'query' }],
  });
  db.$on('query', (event) => {
    if (fx.counting) fx.queries.push(event.query);
  });
  return { db, databaseProvider: () => 'sqlite', isSqliteDatabase: () => true };
});

import { db } from '@/lib/db';
import { auth, SESSION_COOKIE_CACHE_SECONDS } from '@/lib/auth';
import { GET } from '../src/app/api/classes/[id]/route';
import { liveRoomData, workspaceData } from '@/lib/workspace';

const roles = [
  'owner',
  'admin',
  'host',
  'coach2',
  'trainee',
  'unassigned',
  'expired',
  'paused',
  'removed',
  'notEnrolled',
  'outsider',
  'formerCoach',
] as const;
type Role = (typeof roles)[number];
const cookies = {} as Record<Role, string>;
const ids = {} as Record<Role, string>;

async function signUp(role: Role) {
  const result = await auth.api.signUpEmail({
    body: {
      email: `${role.toLowerCase()}@example.test`,
      password: 'poll-budget-pass-1',
      name: role,
    },
    returnHeaders: true,
  });
  cookies[role] = result.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  ids[role] = result.response.user.id;
}

async function poll(role: Role) {
  fx.cookie = cookies[role];
  fx.queries.length = 0;
  fx.deferred.length = 0;
  fx.counting = true;
  const response = await GET(
    new Request('http://localhost:3000/api/classes/live-class', {
      headers: { 'X-Coaching-Client': '2' },
    }),
    { params: Promise.resolve({ id: 'live-class' }) },
  );
  const sql = [...fx.queries];
  const queries = sql.length;
  fx.queries.length = 0;
  for (const task of fx.deferred.splice(0)) await task();
  fx.counting = false;
  const body = await response.json();
  return { status: response.status, body, queries, sql, deferredQueries: fx.queries.length };
}

function outcome(result: Awaited<ReturnType<typeof poll>>) {
  const b = result.body;
  if (result.status !== 200) return { status: result.status };
  const name = (id: string) => roles.find((r) => ids[r] === id) ?? id;
  return {
    status: result.status,
    allowed: b.participationAllowed,
    reason: b.participationReason,
    canManage: b.permissions.canManage,
    host: name(b.permissions.hostId),
    presenters: b.permissions.presenterIds.map(name).sort(),
    coachName: b.coachName,
    participants: b.participants
      .map(
        (p: { id: string; metric: unknown; summary: unknown }) =>
          `${name(p.id)}${p.metric ? '+metric' : ''}${p.summary ? '+summary' : ''}`,
      )
      .sort(),
    messages: b.messages.map((m: { text: string }) => m.text).sort(),
    count: b.participantCount,
    workout: b.workout.length,
  };
}

beforeAll(async () => {
  const migrate = spawnSync(
    process.execPath,
    // The schema the generated client was built from (it can run ahead of this branch's
    // migrations while a schema change is in flight), so the test DB matches the client.
    [
      resolve('node_modules/prisma/build/index.js'),
      'db',
      'push',
      '--skip-generate',
      `--schema=${resolve('node_modules/.prisma/client/schema.prisma')}`,
    ],
    { env: { ...process.env, DATABASE_URL: fx.url }, encoding: 'utf8', windowsHide: true },
  );
  if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
  for (const role of roles) await signUp(role);
  const active = { startsOn: '2000-01-01', endsOn: '2999-12-31' };
  await db.studio.create({ data: { id: 'studio', name: 'Studio A', ownerId: ids.owner } });
  await db.studio.create({ data: { id: 'other', name: 'Studio B', ownerId: ids.outsider } });
  await db.membershipOffer.create({
    data: { id: 'offer', studioId: 'studio', name: 'Monthly', durationDays: 30, pricePaise: 1 },
  });
  await db.studioRoleGrant.createMany({
    data: [
      { studioId: 'studio', userId: ids.admin, role: 'admin' },
      { studioId: 'studio', userId: ids.host, role: 'coach' },
      { studioId: 'studio', userId: ids.coach2, role: 'coach' },
      { studioId: 'studio', userId: ids.formerCoach, role: 'coach', status: 'revoked' },
      { studioId: 'studio', userId: ids.trainee, role: 'trainee' },
      { studioId: 'studio', userId: ids.expired, role: 'trainee' },
      { studioId: 'studio', userId: ids.paused, role: 'trainee' },
      { studioId: 'studio', userId: ids.removed, role: 'trainee', status: 'revoked' },
      { studioId: 'studio', userId: ids.notEnrolled, role: 'trainee' },
    ],
  });
  const members: [Role, string, typeof active | null][] = [
    ['trainee', 'active', active],
    ['unassigned', 'active', active],
    ['expired', 'active', { startsOn: '2000-01-01', endsOn: '2000-12-31' }],
    ['paused', 'paused', active],
    ['removed', 'active', active],
    ['notEnrolled', 'active', active],
  ];
  for (const [role, status, term] of members) {
    const member = await db.studioMember.create({
      data: { studioId: 'studio', userId: ids[role], name: role, status, joinedOn: '2000-01-01' },
    });
    if (role !== 'removed')
      await db.membership.create({ data: { studioId: 'studio', userId: ids[role] } });
    if (term)
      await db.memberTerm.create({
        data: {
          studioId: 'studio',
          memberId: member.id,
          offerId: 'offer',
          planName: 'Monthly',
          feePaise: 1,
          ...term,
        },
      });
    if (role === 'trainee')
      await db.primaryCoachAssignment.create({ data: { memberId: member.id, coachId: ids.host } });
  }
  await db.workoutPlan.create({
    data: {
      id: 'plan',
      studioId: 'studio',
      name: 'Plan',
      description: '',
      blocks: [{ id: 'b1', exercise: 'squat', target: 10 }],
    },
  });
  await db.classSession.create({
    data: {
      id: 'live-class',
      studioId: 'studio',
      hostId: ids.host,
      planId: 'plan',
      title: 'Live',
      startsAt: new Date(),
      status: 'live',
      exercise: 'squat',
      startedAt: new Date(),
      workoutSnapshot: [{ id: 'b1', exercise: 'squat', target: 10 }],
    },
  });
  for (const role of [
    'trainee',
    'unassigned',
    'expired',
    'paused',
    'removed',
    'formerCoach',
  ] as Role[])
    await db.enrollment.create({
      data: { classId: 'live-class', userId: ids[role], consentAt: new Date() },
    });
  const own = await db.enrollment.findUniqueOrThrow({
    where: { classId_userId: { classId: 'live-class', userId: ids.trainee } },
  });
  await db.metric.create({
    data: {
      enrollmentId: own.id,
      exercise: 'squat',
      revision: 0,
      reps: 3,
      confidence: 0.9,
      phase: 'up',
      cue: '',
    },
  });
  await db.workoutSummary.create({ data: { enrollmentId: own.id, totalReps: 3 } });
  await db.message.createMany({
    data: [
      { classId: 'live-class', senderId: ids.host, text: 'everyone', kind: 'cue' },
      {
        classId: 'live-class',
        senderId: ids.host,
        recipientId: ids.trainee,
        text: 'private-trainee',
        kind: 'cue',
      },
      {
        classId: 'live-class',
        senderId: ids.host,
        recipientId: ids.unassigned,
        text: 'private-unassigned',
        kind: 'cue',
      },
    ],
  });
}, 120_000);
afterAll(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-journal']) rmSync(`${fx.file}${suffix}`, { force: true });
});

const staffView = [
  'expired',
  'formerCoach',
  'paused',
  'removed',
  'trainee+metric+summary',
  'unassigned',
];
const accept = 'Accept your studio request to participate.';
/** Recorded from the route before the query cuts (master at 8915325). */
const expected: Record<Role, { status: number } & Record<string, unknown>> = {
  owner: {
    status: 200,
    allowed: true,
    reason: '',
    canManage: true,
    participants: staffView,
    messages: ['everyone'],
  },
  admin: {
    status: 200,
    allowed: true,
    reason: '',
    canManage: true,
    participants: staffView,
    messages: ['everyone'],
  },
  host: {
    status: 200,
    allowed: true,
    reason: '',
    canManage: true,
    participants: staffView,
    messages: ['everyone', 'private-trainee', 'private-unassigned'],
  },
  coach2: { status: 404 },
  trainee: {
    status: 200,
    allowed: true,
    reason: '',
    canManage: false,
    participants: ['trainee+metric+summary'],
    messages: ['everyone', 'private-trainee'],
  },
  unassigned: {
    status: 200,
    allowed: true,
    reason: '',
    canManage: false,
    participants: ['unassigned'],
    messages: ['everyone', 'private-unassigned'],
  },
  expired: {
    status: 200,
    allowed: false,
    reason: 'An active membership is required for this session. Contact your coach to renew.',
    canManage: false,
    participants: ['expired'],
    messages: ['everyone'],
  },
  paused: {
    status: 200,
    allowed: false,
    reason: 'Your studio membership is paused or archived. Contact your coach.',
    canManage: false,
    participants: ['paused'],
    messages: ['everyone'],
  },
  removed: {
    status: 200,
    allowed: false,
    reason: accept,
    canManage: false,
    participants: ['removed'],
    messages: ['everyone'],
  },
  notEnrolled: { status: 404 },
  outsider: { status: 404 },
  formerCoach: {
    status: 200,
    allowed: false,
    reason: accept,
    canManage: false,
    participants: ['formerCoach'],
    messages: ['everyone'],
  },
};
const shared = {
  host: 'host',
  presenters: ['admin', 'host', 'owner'],
  coachName: 'host',
  count: 6,
  workout: 1,
};

describe('live class poll', () => {
  // Before: trainee 21 statements, coach 17 (session 2 + second user read 1 included).
  it('stays within its query budget per poll', async () => {
    const counts: Record<string, number[]> = {};
    for (const role of ['trainee', 'host'] as Role[]) {
      counts[role] = [];
      for (let i = 0; i < 3; i++) {
        const result = await poll(role);
        expect(result.status).toBe(200);
        counts[role].push(result.queries);
        // No LiveKit in tests: the deferred sweep is a no-op and writes no claim row.
        // The only deferred write is the host's throttled presence stamp
        // (src/lib/class-completion.ts), taken on the first host poll only.
        if (role === 'host' && i === 0) expect(result.deferredQueries).toBeGreaterThan(0);
        else expect(result.deferredQueries).toBe(0);
        if (i === 2)
          report(
            `sql-${role}`,
            result.sql.map((q) => q.slice(0, 160)),
          );
      }
    }
    report('counts', counts);
    expect(Math.max(...counts.trainee)).toBeLessThanOrEqual(9);
    expect(Math.max(...counts.host)).toBeLessThanOrEqual(8);
  });

  it('keeps authorization identical for every role', async () => {
    const results = {} as Record<Role, unknown>;
    for (const role of roles) results[role] = outcome(await poll(role));
    report('outcomes', results);
    for (const role of roles)
      expect(results[role], role).toEqual(
        expected[role].status === 200 ? { ...shared, ...expected[role] } : expected[role],
      );
  });

  it('loads the live room with the workspace authorization and far fewer reads', async () => {
    const reads: Record<string, [number, number]> = {};
    for (const role of roles) {
      const user = await db.user.findUniqueOrThrow({ where: { id: ids[role] } });
      fx.queries.length = 0;
      fx.counting = true;
      const full = await workspaceData(user.id, 'live-class');
      const fullReads = fx.queries.length;
      fx.queries.length = 0;
      const room = await liveRoomData(user, 'live-class');
      reads[role] = [fullReads, fx.queries.length];
      fx.counting = false;
      expect(room.item, role).toEqual(full.classes.find((c) => c.id === 'live-class') ?? null);
      expect(room.user).toEqual(full.user);
      expect(room.services).toEqual(full.services);
      expect(room.customExercises).toEqual(full.customExercises);
      expect(room.features).toEqual(full.features);
      expect(fx.queries.length).toBeLessThan(fullReads);
    }
    report('live-room-reads [workspaceData, liveRoomData]', reads);
  });

  it('enforces revoked membership and roles on the next poll despite the session cookie cache', async () => {
    await db.membership.delete({
      where: { studioId_userId: { studioId: 'studio', userId: ids.unassigned } },
    });
    expect(outcome(await poll('unassigned'))).toMatchObject({ allowed: false, reason: accept });
    await db.studioRoleGrant.update({
      where: { studioId_userId_role: { studioId: 'studio', userId: ids.host, role: 'coach' } },
      data: { status: 'revoked' },
    });
    expect((await poll('host')).status).toBe(404);
    await db.studioRoleGrant.update({
      where: { studioId_userId_role: { studioId: 'studio', userId: ids.host, role: 'coach' } },
      data: { status: 'active' },
    });
    expect(outcome(await poll('host'))).toMatchObject({ canManage: true });
  });

  it('stops accepting a revoked session once the cookie cache expires', async () => {
    await db.session.deleteMany({ where: { userId: ids.trainee } });
    // Inside the cache window the signed cookie still identifies the user; every
    // permission was still read from the database.
    expect((await poll('trainee')).status).toBe(200);
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() + (SESSION_COOKIE_CACHE_SECONDS + 1) * 1000,
    });
    try {
      const expired = await poll('trainee');
      expect(expired.status).toBe(401);
      // A live session past the cache window costs one Session+User lookup, once per window.
      const refreshed = await poll('host');
      expect(refreshed.status).toBe(200);
      expect(refreshed.queries).toBeLessThanOrEqual(10);
      report('cache-miss-queries', { revoked: expired.queries, host: refreshed.queries });
    } finally {
      vi.useRealTimers();
    }
  });
});
/** Set POLL_REPORT to a file path to record the measured numbers. */
function report(label: string, value: unknown) {
  if (process.env.POLL_REPORT)
    appendFileSync(process.env.POLL_REPORT, `${label} ${JSON.stringify(value, null, 1)}\n`);
}
