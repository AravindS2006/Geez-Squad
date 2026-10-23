import { NextResponse } from 'next/server';
import { requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { loggedRoute } from '@/lib/request-log';
import { readTeam, mutateTeam, teamCommand } from '@/lib/studio-team';
export const GET = loggedRoute('/api/studio-team', async () => {
  try {
    const user = await requireUser();
    return NextResponse.json(await readTeam(user.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return safeError(error);
  }
});
export const POST = loggedRoute('/api/studio-team', async (request) => {
  try {
    const user = await requireUser();
    const command = teamCommand.parse(await readJson(request));
    await rateLimit(user.id, 'studio-team', 20);
    return NextResponse.json(await mutateTeam(user.id, command));
  } catch (error) {
    return safeError(error);
  }
});
