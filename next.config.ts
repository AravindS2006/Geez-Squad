import type { NextConfig } from 'next';
import { buildContentSecurityPolicy } from './src/lib/content-security-policy';
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ['@prisma/client'],
  async headers() {
    // Pages get a per-request nonce CSP from src/proxy.ts. Static documents that the proxy skips
    // (pose worker, service worker, offline page) and API responses get the same policy without
    // a nonce, so no response carries two policies and none allows inline scripts.
    const staticPolicy = buildContentSecurityPolicy({
      livekitUrl: process.env.LIVEKIT_URL,
      isDev: process.env.NODE_ENV === 'development',
    });
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // Content-addressed pose assets (vision bundle, WASM, models): the version segment
        // changes whenever MediaPipe or a pinned model changes (scripts/pose-assets.mjs).
        source: '/pose-assets/:version/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          // Browsers ignore HSTS on plain-HTTP localhost, so local development is unaffected.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      {
        source: '/(pose-worker\\.js|sw\\.js|offline\\.html)',
        headers: [{ key: 'Content-Security-Policy', value: staticPolicy }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: staticPolicy }],
      },
    ];
  },
};
export default config;
