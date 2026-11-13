import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loggedRoute } from '@/lib/request-log';
import { requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { deleteOwnAccount } from '@/lib/account-deletion';
import { ACCOUNT_DELETION_CONFIRMATION } from '@/lib/account-deletion-policy';

const schema = z
  .object({
    action: z.literal('delete'),
    confirm: z.literal(ACCOUNT_DELETION_CONFIRMATION, {
      error: `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm.`,
    }),
    password: z.string().min(1, 'Enter your password.').max(128),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const user = await requireUser({ freshSession: true });
    const data = schema.parse(await readJson(request));
    // A low limit bounds password guessing through this endpoint.
    await rateLimit(user.id, 'account-delete', 5);
    await deleteOwnAccount(user.id, data.password);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/account', handlePOST);
