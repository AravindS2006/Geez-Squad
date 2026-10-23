import { classPermissions } from '@/lib/studio-access';
import { loggedRoute } from '@/lib/request-log';
import { requireParticipation } from '@/lib/member-access';
import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import {
  ApiError,
  requireUser,
  readJson,
  rateLimit,
  requireClass,
  safeError,
} from '@/lib/security';
import { classVideoGrant } from '@/lib/video-grants';
import { existingVideoRoomName } from '@/lib/room-identity';
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const { classId } = z.object({ classId: z.string().max(100) }).parse(await readJson(request));
    await rateLimit(user.id, 'token', 10);
    const item = await requireClass(classId, user.id);
    const permissions = await classPermissions(item, user.id);
    if (!permissions.canManage) await requireParticipation(item.studioId, user.id);
    if (item.status !== 'live')
      throw new ApiError(409, 'The coach has not started this class, or it has ended.');
    if (!permissions.canManage && !item.enrollments.find((e) => e.userId === user.id)?.consentAt)
      throw new ApiError(403, 'Please complete the sharing consent first.');
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET)
      throw new ApiError(
        503,
        'Live video is not configured yet. Camera practice still works locally.',
      );
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: user.id,
      name: user.name,
      ttl: '5m',
    });
    token.addGrant(classVideoGrant(item.id, permissions.canManage, existingVideoRoomName(item)));
    return NextResponse.json(
      { token: await token.toJwt(), url: process.env.LIVEKIT_URL },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/video/token', handlePOST);
