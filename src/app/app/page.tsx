import { redirect } from 'next/navigation';
import { ApiError, requireUser } from '@/lib/security';
import { workspaceData } from '@/lib/workspace';
import { Workspace } from '@/components/workspace';
export const dynamic = 'force-dynamic';
export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.code === 'EMAIL_VERIFICATION_REQUIRED')
      redirect('/login?mode=verify');
    throw error;
  }
  const query = await searchParams;
  return <Workspace initial={await workspaceData(user.id)} view={query.view || 'dashboard'} />;
}
