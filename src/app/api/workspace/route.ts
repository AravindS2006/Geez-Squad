import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import { requireUser, safeError } from '@/lib/security';
import { workspaceData } from '@/lib/workspace';
async function handleGET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await workspaceData(user.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return safeError(error);
  }
}

export const GET = loggedRoute('/api/workspace', handleGET);
