import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorContext, logEvent } from '@/lib/logger';
import { requestContext } from '@/lib/request-log';
import {
  failingChecks,
  hasHealthToken,
  livekitStatus,
  mailStatus,
  schemaProbeSql,
  type HealthChecks,
} from '@/lib/health';

const probe = schemaProbeSql();

async function databaseStatus(): Promise<HealthChecks['database']> {
  try {
    // Every table and column the deployed client expects, without reading records.
    // A reachable database with unapplied migrations must not report healthy.
    await db.$queryRawUnsafe(probe);
    return 'ok';
  } catch (error) {
    logEvent('error', 'schema_readiness_failed', {
      ...requestContext.getStore(),
      ...errorContext(error),
    });
    return 'down';
  }
}

async function handleGET(request: Request) {
  const [database, livekit] = await Promise.all([databaseStatus(), livekitStatus()]);
  const checks: HealthChecks = { database, livekit, mail: mailStatus() };
  const failing = failingChecks(checks);
  if (failing.length)
    logEvent('error', 'health_dependency_down', {
      ...requestContext.getStore(),
      action: failing.join(','),
    });
  // Anonymous callers get the overall status only, so the response does not reveal which
  // services are configured. With the health token, status words per dependency (still
  // no hostnames, versions, provider names or error text).
  const status = failing.length ? 'unavailable' : 'ok';
  const detailed = hasHealthToken(request.headers.get('authorization'));
  return NextResponse.json(detailed ? { status, checks } : { status }, {
    status: failing.length ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = loggedRoute('/api/health', handleGET);
