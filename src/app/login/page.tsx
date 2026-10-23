import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { emailPolicy } from '@/lib/auth';
import { ApiError, requireUser } from '@/lib/security';
import { accountDestination } from '@/lib/login-destination';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const query = await searchParams;
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? null;
  let user;
  let verificationRequired = false;
  // A reset link must remain usable even when another session already exists.
  if (!(first(query.token) && emailPolicy.passwordResetEnabled)) {
    try {
      user = await requireUser();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_VERIFICATION_REQUIRED')
        verificationRequired = true;
      else if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    if (user) redirect(accountDestination(first(query.next), first(query.invite)));
  }
  return (
    <Suspense fallback={<div className="page-loading">Loading…</div>}>
      <AuthForm
        testingMode={emailPolicy.testingMode}
        signupEnabled={emailPolicy.signupEnabled}
        passwordResetEnabled={emailPolicy.passwordResetEnabled}
        verificationRequired={verificationRequired}
      />
    </Suspense>
  );
}
