const fallbackOrigin = 'https://geez-squad.vercel.app';

/** Canonical public origin for metadata, sitemap and robots. Never throws. */
export function siteOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL;
  if (!configured) return fallbackOrigin;
  try {
    return new URL(configured).origin;
  } catch {
    return fallbackOrigin;
  }
}
