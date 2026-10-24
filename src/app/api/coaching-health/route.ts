import { z } from 'zod';
import { NextResponse } from 'next/server';
import { requireUser, readJson, safeError, rateLimit } from '@/lib/security';
import { logEvent } from '@/lib/logger';
import { loggedRoute } from '@/lib/request-log';
const schema = z
  .object({
    event: z.enum([
      'model_startup_failed',
      'inference_slow',
      'tracking_low',
      'save_failed',
      'media_join_failed',
      'media_reconnected',
      'stale_summary',
    ]),
    durationMs: z.number().int().min(0).max(60000).optional(),
  })
  .strict();
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const data = schema.parse(await readJson(request));
    await rateLimit(user.id, 'coaching-health', 12);
    logEvent('warn', 'coaching_health', { code: data.event, durationMs: data.durationMs });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeError(error);
  }
}
export const POST = loggedRoute('/api/coaching-health', handlePOST);
