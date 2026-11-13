import { NextResponse } from 'next/server';
import { loggedRoute } from '@/lib/request-log';
import { requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { studioOwnershipCommand } from '@/lib/studio-lifecycle-policy';
import { closeStudio, readOwnership, transferOwnership } from '@/lib/studio-lifecycle';

const noStore = { headers: { 'Cache-Control': 'private, no-store' } };

async function get() {
  try {
    const actor = await requireUser();
    return NextResponse.json(await readOwnership(actor), noStore);
  } catch (error) {
    return safeError(error);
  }
}

async function post(request: Request) {
  try {
    const actor = await requireUser();
    const command = studioOwnershipCommand.parse(await readJson(request));
    // A low limit bounds password guessing, as on account deletion.
    await rateLimit(actor.id, 'studio-ownership', 5);
    const result =
      command.action === 'transfer'
        ? await transferOwnership(actor, command.userId, command.password)
        : await closeStudio(actor, command.password);
    return NextResponse.json(result, noStore);
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/studio-ownership', get);
export const POST = loggedRoute('/api/studio-ownership', post);
