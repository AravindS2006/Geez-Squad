import { z } from 'zod';

/**
 * Pure rules for the studio lifecycle: operator-approved creation, ownership
 * transfer and closure. Server code lives in `studio-lifecycle.ts`.
 */

export const STUDIO_CLOSE_CONFIRMATION = 'CLOSE';
export const OWNERSHIP_TRANSFER_CONFIRMATION = 'TRANSFER';

/** `PLATFORM_OPERATOR_EMAILS`: comma or whitespace separated, case-insensitive. */
export function operatorEmails(env: Record<string, string | undefined>) {
  return new Set(
    (env.PLATFORM_OPERATOR_EMAILS ?? '')
      .split(/[\s,]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes('@')),
  );
}

/**
 * A platform operator is a signed-in account whose email has been verified and
 * appears on the deployment allow-list. Job titles, studio roles and the user
 * `role` column never make someone an operator. An unverified address never
 * counts, even when email verification is not enforced for sign-in, because
 * anyone could register an allow-listed address that nobody has proved they own.
 */
export function isPlatformOperator(
  user: { email: string; emailVerified: boolean },
  env: Record<string, string | undefined>,
) {
  return user.emailVerified && operatorEmails(env).has(user.email.trim().toLowerCase());
}

/** Requests are reviewed once; a repeated approval returns the original result. */
export type StudioRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export function reviewOutcome(
  current: StudioRequestStatus | string,
  decision: 'approve' | 'reject',
): 'apply' | 'repeat' | 'conflict' {
  if (current === 'pending') return 'apply';
  if (
    (decision === 'approve' && current === 'approved') ||
    (decision === 'reject' && current === 'rejected')
  )
    return 'repeat';
  return 'conflict';
}

/**
 * Placeholder owner for a closed studio whose real owner erased their account.
 * `Studio.owner` cascades on user deletion, so the studio (and its member,
 * payment and attendance records) is re-pointed to this row instead of being
 * erased. It has no credential, no session and an address on the reserved
 * `.invalid` domain, so it can never sign in or receive mail; a closed studio
 * grants nobody access in any case.
 */
export function closedStudioOwner(studioId: string) {
  return {
    id: `closed-studio-${studioId}`,
    name: 'Closed studio',
    email: `closed-studio-${studioId}@closed.invalid`,
    role: 'system',
    emailVerified: false,
  };
}

const text = (max: number) => z.string().trim().max(max);
const id = z.string().min(1).max(100);

export const studioRequestCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('submit'),
      name: text(80).pipe(z.string().min(2, 'Enter the studio name.')),
      contactPhone: text(40).pipe(z.string().min(6, 'Enter a contact phone number.')),
      note: text(600).default(''),
    })
    .strict(),
  z.object({ action: z.literal('approve'), requestId: id }).strict(),
  z.object({ action: z.literal('reject'), requestId: id }).strict(),
  z.object({ action: z.literal('withdraw'), requestId: id }).strict(),
]);

export const studioOwnershipCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('transfer'),
      userId: id,
      confirm: z.literal(OWNERSHIP_TRANSFER_CONFIRMATION, {
        error: `Type ${OWNERSHIP_TRANSFER_CONFIRMATION} to confirm.`,
      }),
      password: z.string().min(1, 'Enter your password.').max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('close'),
      confirm: z.literal(STUDIO_CLOSE_CONFIRMATION, {
        error: `Type ${STUDIO_CLOSE_CONFIRMATION} to confirm.`,
      }),
      password: z.string().min(1, 'Enter your password.').max(128),
    })
    .strict(),
]);
