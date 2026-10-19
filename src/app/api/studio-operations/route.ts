import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';
import { operationsSchema } from '@/lib/studio-operations';
import { readOperations, mutateOperations } from '@/lib/studio-operations-server';

export async function GET() {
  try {
    const user = await requireUser();
    const studio = await db.studio.findUnique({ where: { ownerId: user.id } });
    if (!studio || user.role !== 'coach')
      throw new ApiError(403, 'Only the studio owner can access studio operations.');
    return NextResponse.json(await readOperations(studio.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return safeError(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const studio = await db.studio.findUnique({ where: { ownerId: user.id } });
    if (!studio || user.role !== 'coach')
      throw new ApiError(403, 'Only the studio owner can manage studio operations.');
    const command = operationsSchema.parse(await readJson(request));
    await rateLimit(user.id, 'studio-operations');
    return NextResponse.json(await mutateOperations(studio.id, user.id, command));
  } catch (error) {
    return safeError(error);
  }
}
