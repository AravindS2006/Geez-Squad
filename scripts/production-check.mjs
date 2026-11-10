import { validateProductionConfig } from './production-config.mjs';
import { getEmailPolicy } from '../src/lib/email-policy.mjs';
const errors = validateProductionConfig(process.env);
if (errors.length) {
  console.error(
    'Production configuration needs attention:\n' + errors.map((error) => `- ${error}`).join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log(
    'Production configuration validated. Provider connectivity and sending-domain verification still require live checks.',
  );
  const policy = getEmailPolicy({ ...process.env, VERCEL: '1' });
  if (!policy.deliveryEnabled)
    console.log('Email delivery disabled: production signup and password reset are unavailable.');
}
