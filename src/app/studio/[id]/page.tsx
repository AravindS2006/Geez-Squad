import { redirect, notFound } from 'next/navigation';
import { ApiError, requireUser } from '@/lib/security';
import { workspaceData } from '@/lib/workspace';
import { StudioPage } from '@/components/studio-page';
export const dynamic = 'force-dynamic';
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
  const data = await workspaceData(user.id, id);
  const item = data.classes.find((c) => c.id === id);
  if (!item) notFound();
  return (
    <StudioPage
      item={item}
      user={data.user}
      services={data.services}
      customExercises={data.customExercises}
      features={data.features}
    />
  );
}
