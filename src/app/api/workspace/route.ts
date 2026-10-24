import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { requireUser, safeError, ApiError } from '@/lib/security';
import { workspaceData } from '@/lib/workspace';
import { isAutomaticExercise } from '@/lib/exercise-library';
async function handleGET(request: Request) {
  try {
    const user = await requireUser();
    const data = await workspaceData(user.id);
    if (
      request.headers.get('X-Coaching-Client') !== '2' &&
      data.plans.some((p) => p.blocks.some((b) => !isAutomaticExercise(b.exercise)))
    )
      throw new ApiError(
        409,
        'Reload this page to use the expanded exercise library.',
        'CLIENT_UPDATE_REQUIRED',
      );
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/workspace', handleGET);
