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
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ${livekit} ${endpoint}${cloudSources}; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
