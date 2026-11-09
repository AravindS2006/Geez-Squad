import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Geez Squad',
    short_name: 'Geez Squad',
    description: 'Your studio, coaching, nutrition and training, together.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8f4',
    theme_color: '#f7f8f4',
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Camera practice',
        url: '/app?view=practice',
        icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Nutrition journal',
        url: '/app?view=nutrition',
        icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
