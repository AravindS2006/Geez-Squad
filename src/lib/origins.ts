type Env = Record<string, string | undefined>;
/**
 * Browser origins allowed to call authenticated routes. Vercel preview
 * deployments are served from a per-deployment host, so `https://${VERCEL_URL}` is
 * accepted only when VERCEL_ENV is exactly `preview`; production and local
 * builds accept only the configured BETTER_AUTH_URL origin.
 */
export function allowedOrigins(env: Env = process.env, fallbackUrl = 'http://localhost:3000') {
  const origins = [new URL(env.BETTER_AUTH_URL || fallbackUrl).origin];
  const host = env.VERCEL_URL?.trim();
  if (env.VERCEL_ENV === 'preview' && host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) {
    const preview = `https://${host.toLowerCase()}`;
    if (!origins.includes(preview)) origins.push(preview);
  }
  return origins;
}
export function isAllowedOrigin(
  origin: string | null,
  env: Env = process.env,
  fallbackUrl?: string,
) {
  return !!origin && allowedOrigins(env, fallbackUrl).includes(origin);
}
