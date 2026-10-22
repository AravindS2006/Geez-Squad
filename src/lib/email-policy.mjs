/** Shared by the deployment guard and authentication configuration.
 * @param {Record<string, string | undefined>} env
 */
export function getEmailPolicy(env) {
  const mode = env.EMAIL_DELIVERY ?? (env.VERCEL === '1' ? 'resend' : 'disabled');
  if (!['resend', 'smtp', 'disabled', 'test'].includes(mode))
    throw new Error('EMAIL_DELIVERY must be resend, smtp, disabled, or test.');
  const deliveryEnabled = mode === 'resend' || mode === 'smtp';
  const testingMode = mode === 'test';
  const requireVerification = deliveryEnabled || (env.VERCEL === '1' && !testingMode);
  return {
    mode,
    testingMode,
    deliveryEnabled,
    requireVerification,
    signupEnabled: !requireVerification || deliveryEnabled,
    passwordResetEnabled: deliveryEnabled,
  };
}
