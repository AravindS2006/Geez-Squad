import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ApiError, requireUser } from '@/lib/security';
import { InviteAccept } from '@/components/invite-accept';
export const metadata: Metadata = { title: 'Studio invitation', robots: { index: false } };
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.code === 'EMAIL_VERIFICATION_REQUIRED')
    )
      redirect(
        `/login?${error.status === 403 ? 'mode=verify&' : ''}invite=${encodeURIComponent(code || '')}`,
      );
    throw error;
  }
  if (user.role === 'unset') redirect(`/app?view=setup&invite=${encodeURIComponent(code || '')}`);
  return <InviteAccept code={code || ''} />;
}
