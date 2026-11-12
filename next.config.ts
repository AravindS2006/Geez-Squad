import type { NextConfig } from 'next';
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ['@prisma/client'],
  async headers() {
    const livekit = process.env.LIVEKIT_URL || 'wss://*.livekit.cloud';
    const endpoint = livekit.startsWith('wss://')
      ? livekit.replace('wss://', 'https://')
      : livekit.replace('ws://', 'http://');
    // LiveKit Cloud selects and reconnects through regional hosts.
    const cloudSources =
      livekit.endsWith('.livekit.cloud') || livekit.includes('*.livekit.cloud')
        ? ' wss://*.livekit.cloud https://*.livekit.cloud'
        : '';
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
          {
            // script-src keeps 'unsafe-inline': App Router streams its flight data as inline
            // scripts, and most pages (landing, login, docs) are statically generated, where
            // per-request nonces cannot be injected. Removing it requires a nonce proxy and
            // dynamic rendering for every page; the MediaPipe worker itself only needs
            // worker-src blob: and 'wasm-unsafe-eval'.
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${livekit} ${endpoint}${cloudSources}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
