import type { Metadata, Viewport } from 'next';
import './globals.css';
import './operations.css';
import './meeting.css';
import './next-phase.css';
import { TimeProvider } from '@/components/time-provider';
import { AppInstall } from '@/components/app-install';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14191c',
};
export const metadata: Metadata = {
  title: 'Geez Squad — Stronger, together.',
  description:
    'Your fitness studio, connected. Memberships, classes, personal coaching, and a community that moves you forward.',
  icons: { icon: '/icon.svg', apple: '/pwa/icon-192.png' },
  appleWebApp: { capable: true, title: 'Geez Squad', statusBarStyle: 'default' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TimeProvider>{children}</TimeProvider>
        <AppInstall />
      </body>
    </html>
  );
}
