import { redirect, notFound } from 'next/navigation';
import { requireUser } from '@/lib/security';
import { workspaceData } from '@/lib/workspace';
import { StudioPage } from '@/components/studio-page';
export const dynamic = 'force-dynamic';
export default async function LiveStudio({ params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/login');
  }
  const { id } = await params;
  const data = await workspaceData(user.id, id);
  const item = data.classes.find((c) => c.id === id);
  if (!item) notFound();
  return <StudioPage item={item} user={data.user} services={data.services} />;
}
