import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { ApiError, requireUser } from '@/lib/security';
import { liveRoomData } from '@/lib/workspace';
import { StudioPage } from '@/components/studio-page';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Live session', robots: { index: false } };
export default async function LiveStudio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'EMAIL_VERIFICATION_REQUIRED')
      redirect(`/login?mode=verify&next=${encodeURIComponent(`/studio/${id}`)}`);
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    redirect(`/login?next=${encodeURIComponent(`/studio/${id}`)}`);
  }
  // Only the live room's own data; the full workspace payload is not needed here.
  const data = await liveRoomData(user, id);
  if (!data.item) notFound();
  return (
    <StudioPage
      item={data.item}
      user={data.user}
      services={data.services}
      customExercises={data.customExercises}
      features={data.features}
    />
  );
}
