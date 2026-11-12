import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { redactPath, redactText, stackFrames } from './redact';

/** Bytes accepted per report: one error with a trimmed stack. */
export const CLIENT_ERROR_MAX_BYTES = 8_000;

export const clientErrorSchema = z
  .object({
    source: z.enum(['window', 'rejection', 'boundary', 'global-boundary']),
    name: z.string().max(80).optional(),
    message: z.string().max(500),
    stack: z.string().max(4000).optional(),
    url: z.string().max(2000).optional(),
    digest: z.string().max(100).optional(),
  })
  .strict();
export type ClientErrorInput = z.infer<typeof clientErrorSchema>;

/** Only redacted, allow-listed fields reach the log: never cookies, bodies or query strings. */
export function clientErrorLogContext(input: ClientErrorInput) {
  return {
    source: input.source,
    type: redactText(input.name, 80) || 'Error',
    detail: redactText(input.message) || undefined,
    frames: stackFrames(input.stack),
    path: redactPath(input.url),
    digest: input.digest && /^[A-Za-z0-9_-]{1,100}$/.test(input.digest) ? input.digest : undefined,
  };
}

/** Rate-limit key for an anonymous caller. The raw address never reaches the database. */
export function clientAddressKey(headers: Headers) {
  const address =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown';
  // Keyed, so the short IPv4 space cannot be reversed from the stored key.
  const key = process.env.BETTER_AUTH_SECRET || 'geez-squad-client-errors';
  return `ip-${createHmac('sha256', key).update(address).digest('hex').slice(0, 32)}`;
}

/** Body as text with a hard byte cap, for sendBeacon (text/plain) and fetch (JSON). */
export async function readBoundedBody(request: Request, max = CLIENT_ERROR_MAX_BYTES) {
  if (Number(request.headers.get('content-length') || 0) > max) return { tooLarge: true as const };
  const reader = request.body?.getReader();
  if (!reader) return { text: '' };
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > max) {
      await reader.cancel();
      return { tooLarge: true as const };
    }
    chunks.push(part.value);
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)) };
}
