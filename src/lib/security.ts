import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { auth, emailPolicy } from './auth';
import { db } from './db';
import { errorContext, logEvent } from './logger';
import { requestContext } from './request-log';
import { classPermissions } from './studio-access';
import { isAllowedOrigin } from './origins';
import { FixedWindows, fixedWindow } from './rate-window';
import type { Prisma } from '@prisma/client';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
async function currentSession(freshSession = false) {
  const session = await auth.api.getSession({
    headers: await headers(),
    ...(freshSession ? { query: { disableCookieCache: true } } : {}),
  });
  if (!session) throw new ApiError(401, 'Please sign in to continue.');
  return session;
}
/**
 * The signed-in user, read from the User table. The session itself may come from the
 * short-lived session cookie cache (`SESSION_COOKIE_CACHE_SECONDS`); pass
 * `freshSession` for actions that must reject a session revoked seconds ago.
 */
export async function requireUser(options: { freshSession?: boolean } = {}) {
  const session = await currentSession(options.freshSession);
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw new ApiError(401, 'Your session has expired.');
  if (emailPolicy.requireVerification && !user.emailVerified)
    throw new ApiError(
      403,
      'Please verify your email, then sign in to continue.',
      'EMAIL_VERIFICATION_REQUIRED',
    );
  return user;
}
/**
 * Identity only, for high-frequency reads such as the live-class poll: no User row
 * read when the session cookie cache is valid. Callers must authorize with
 * database-backed checks (studio role, membership, enrollment) keyed by `id`; a
 * deleted account has none, so it only ever reaches 404s. Fields other than `id` may
 * be up to `SESSION_COOKIE_CACHE_SECONDS` old.
 */
export async function requireSessionUser(): Promise<{ id: string; name: string }> {
  const session = await currentSession();
  // A cached "unverified" flag may predate verification; let the database decide.
  if (emailPolicy.requireVerification && !session.user.emailVerified) return requireUser();
  return { id: session.user.id, name: session.user.name };
}
export function checkOrigin(request: Request) {
  if (!isAllowedOrigin(request.headers.get('origin'), process.env, request.url))
    throw new ApiError(403, 'This request origin is not allowed.');
}
export async function readJson(request: Request) {
  checkOrigin(request);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'Use JSON for this request.');
  if (Number(request.headers.get('content-length') || 0) > 16000)
    throw new ApiError(413, 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Missing request body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 16000) {
      await reader.cancel();
      throw new ApiError(413, 'This request is too large.');
    }
    chunks.push(part.value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Invalid JSON.');
  }
}
const RATE_WINDOW_MS = 60_000;
const rateWindows = new FixedWindows();
/**
 * Shared fixed-window limit (one RateLimit row per user, action and minute). Once this
 * instance has seen a key over its limit, later calls in the same minute are refused
 * without another database write, so a client hammering a route cannot turn each
 * refused request into a write.
 */
export async function rateLimit(
  userId: string,
  action: string,
  max = 60,
  store: Pick<Prisma.TransactionClient, 'rateLimit'> = db,
) {
  const now = Date.now();
  const { bucket, until } = fixedWindow(now, RATE_WINDOW_MS);
  const key = `app:${action}:${userId}:${bucket}`;
  if (rateWindows.blocked(key, now))
    throw new ApiError(429, 'Please wait a minute before trying again.');
  const row = await store.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, lastRequest: BigInt(now) },
    update: { count: { increment: 1 }, lastRequest: BigInt(now) },
  });
  if (row.count > max) {
    rateWindows.block(key, until, now);
    throw new ApiError(429, 'Please wait a minute before trying again.');
  }
}
/**
 * Per-instance limit with no database write, for high-frequency calls that also apply
 * a shared bound of their own (the metrics route charges `rateLimit` for summaries
 * faster than `METRIC_STEADY_INTERVAL_MS`). It is a first filter, not cross-instance
 * abuse protection on its own.
 */
export function localRateLimit(userId: string, action: string, max: number) {
  const now = Date.now();
  const { bucket, until } = fixedWindow(now, RATE_WINDOW_MS);
  if (rateWindows.hit(`local:${action}:${userId}:${bucket}`, until, now) > max)
    throw new ApiError(429, 'Please wait a minute before trying again.');
}
export function resetRateWindows() {
  rateWindows.clear();
}
export function safeError(error: unknown) {
  const context = requestContext.getStore();
  const requestId = context?.requestId ?? crypto.randomUUID();
  if (error instanceof ApiError) {
    logEvent(error.status >= 500 ? 'error' : 'warn', 'api_rejected', {
      ...context,
      requestId,
      status: error.status,
      code: error.code,
    });
    return NextResponse.json(
      { error: error.message, requestId, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message ?? 'Please check the fields.', requestId },
      { status: 400 },
    );
  logEvent('error', 'api_error', { ...context, requestId, ...errorContext(error) });
  return NextResponse.json(
    { error: 'Something went wrong. Please retry.', requestId },
    { status: 500 },
  );
}
export async function requireClass(id: string, userId: string) {
  const item = await db.classSession.findUnique({
    where: { id },
    include: {
      studio: true,
      enrollments: {
        include: { user: { select: { id: true, name: true } }, metric: true, summary: true },
      },
    },
  });
  if (
    !item ||
    (!(await classPermissions(item, userId)).canManage &&
      !item.enrollments.some((e) => e.userId === userId))
  )
    throw new ApiError(404, 'This session is not available.');
  return item;
}
