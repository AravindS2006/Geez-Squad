import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, createNonce } from '@/lib/content-security-policy';

/**
 * Sets a per-request nonce-based Content-Security-Policy on pages. Next.js reads the nonce from
 * the request CSP header and applies it to its own scripts. Every page must render dynamically
 * for this to work (the root layout awaits connection()).
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    livekitUrl: process.env.LIVEKIT_URL,
    isDev: process.env.NODE_ENV === 'development',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: skip API routes, build assets, image optimisation, metadata files and any
      // public/ file with an extension (those get the static policy from next.config.ts).
      source:
        '/((?!api/|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|.*\\.[a-zA-Z0-9]+$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
