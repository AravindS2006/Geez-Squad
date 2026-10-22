import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { auth, emailPolicy } from './auth';
import { db } from './db';
import { errorContext, logEvent } from './logger';
import { requestContext } from './request-log';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new ApiError(401, 'Please sign in to continue.');
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
export function checkOrigin(request: Request) {
  const expected = new URL(process.env.BETTER_AUTH_URL || request.url).origin;
  if (request.headers.get('origin') !== expected)
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
export async function rateLimit(userId: string, action: string, max = 60) {
  const bucket = Math.floor(Date.now() / 60000);
  const key = `app:${action}:${userId}:${bucket}`;
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, lastRequest: BigInt(Date.now()) },
    update: { count: { increment: 1 }, lastRequest: BigInt(Date.now()) },
  });
  if (row.count > max) throw new ApiError(429, 'Please wait a minute before trying again.');
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
    (item.studio.ownerId !== userId && !item.enrollments.some((e) => e.userId === userId))
  )
    throw new ApiError(404, 'This session is not available.');
  return item;
}
