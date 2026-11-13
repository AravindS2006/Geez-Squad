import { NextResponse } from 'next/server';
import { loggedRoute } from '@/lib/request-log';
import { requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { studioRequestCommand } from '@/lib/studio-lifecycle-policy';
import {
  readStudioRequests,
  reviewStudioRequest,
  submitStudioRequest,
  withdrawStudioRequest,
} from '@/lib/studio-lifecycle';

const noStore = { headers: { 'Cache-Control': 'private, no-store' } };

async function get() {
  try {
    const actor = await requireUser();
    return NextResponse.json(await readStudioRequests(actor), noStore);
  } catch (error) {
    return safeError(error);
  }
}

async function post(request: Request) {
  try {
    const actor = await requireUser();
    const command = studioRequestCommand.parse(await readJson(request));
    if (command.action === 'submit' || command.action === 'withdraw') {
      await rateLimit(actor.id, 'studio-request', 5);
      const result =
        command.action === 'submit'
          ? await submitStudioRequest(actor, {
              name: command.name,
              contactPhone: command.contactPhone,
              note: command.note,
            })
          : await withdrawStudioRequest(actor, command.requestId);
      return NextResponse.json(result, noStore);
    }
    // Operator check runs inside reviewStudioRequest before any read.
    await rateLimit(actor.id, 'studio-review', 30);
    return NextResponse.json(
      await reviewStudioRequest(actor, command.requestId, command.action),
      noStore,
    );
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/studio-requests', get);
export const POST = loggedRoute('/api/studio-requests', post);
