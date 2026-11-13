import { requireStudio } from '@/lib/studio-access';
import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { operationsSchema } from '@/lib/studio-operations';
import {
  readOperations,
  readPaymentHistory,
  mutateOperations,
} from '@/lib/studio-operations-server';

async function handleGET(request: Request) {
  try {
    const user = await requireUser();
    const { studio } = await requireStudio(user.id, 'admin');
    const q = new URL(request.url).searchParams;
    // `?payments=all` (optionally with `cursor`) pages the full payment history.
    if (q.get('payments') === 'all')
      return NextResponse.json(await readPaymentHistory(studio.id, q.get('cursor')), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    return NextResponse.json(await readOperations(studio.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return safeError(error);
  }
}
async function handlePOST(request: Request) {
  try {
    const user = await requireUser({ freshSession: true });
    const { studio } = await requireStudio(user.id, 'admin');
    const command = operationsSchema.parse(await readJson(request));
    await rateLimit(user.id, 'studio-operations');
    return NextResponse.json(await mutateOperations(studio.id, user.id, command));
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/studio-operations', handleGET);

export const POST = loggedRoute('/api/studio-operations', handlePOST);
