import { z } from 'zod';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser, readJson, safeError, rateLimit } from '@/lib/security';
import { logEvent } from '@/lib/logger';
import { loggedRoute } from '@/lib/request-log';
import { healthScope } from '@/lib/coaching-health-scope';
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
    classId: z.string().min(1).max(100).optional(),
  })
  .strict();
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const data = schema.parse(await readJson(request));
    await rateLimit(user.id, 'coaching-health', 12);
    // The user comes from the session; the class and studio only when this user may see them.
    const scope = await db.$transaction((tx) => healthScope(user.id, data.classId, tx));
    logEvent('warn', 'coaching_health', {
      code: data.event,
      durationMs: data.durationMs,
      actorId: user.id,
      studioId: scope.studioId,
      // The logger has no class field; targetId carries the class for this event.
      targetId: scope.classId,
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return safeError(error);
  }
}
export const POST = loggedRoute('/api/coaching-health', handlePOST);
