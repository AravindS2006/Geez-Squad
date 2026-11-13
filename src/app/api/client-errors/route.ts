import { headers } from 'next/headers';
import { loggedRoute, requestContext } from '@/lib/request-log';
import { auth } from '@/lib/auth';
import { logEvent } from '@/lib/logger';
import { ApiError, checkOrigin, rateLimit, safeError } from '@/lib/security';
import {
  ANONYMOUS_BUCKET,
  CLIENT_ERROR_LIMITS,
  clientAddressKey,
  clientErrorLogContext,
  clientErrorSchema,
  readBoundedBody,
} from '@/lib/client-error-report';

// Browser error reports. Signed-out pages crash too, so no session is required; a
// session, when present, only adds the actor id. Reports are logged at warn level and
// never alert, so an anonymous caller cannot page the operator.
async function handlePOST(request: Request) {
  try {
    checkOrigin(request);
    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('application/json') && !type.startsWith('text/plain'))
      throw new ApiError(415, 'Use JSON for this request.');
    // No cookie means no session lookup in the database, so this stays cheap.
    let actorId: string | undefined;
    try {
      actorId = (await auth.api.getSession({ headers: await headers() }))?.user.id;
    } catch {
      actorId = undefined;
    }
    if (actorId) await rateLimit(actorId, 'client-error', CLIENT_ERROR_LIMITS.perUser);
    // One shared bucket first, so rotating a forwarded address cannot exceed it or keep
    // creating per-address rate-limit rows once it is spent.
    else await rateLimit(ANONYMOUS_BUCKET, 'client-error', CLIENT_ERROR_LIMITS.anonymousTotal);
    await rateLimit(
      clientAddressKey(request.headers),
      'client-error',
      CLIENT_ERROR_LIMITS.perAddress,
    );
    const body = await readBoundedBody(request);
    if ('tooLarge' in body) throw new ApiError(413, 'This request is too large.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      throw new ApiError(400, 'Invalid JSON.');
    }
    const input = clientErrorSchema.parse(parsed);
    logEvent('warn', 'client_error', {
      ...requestContext.getStore(),
      ...clientErrorLogContext(input),
      actorId,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/client-errors', handlePOST);
