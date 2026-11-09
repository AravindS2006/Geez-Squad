import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './tokens.css';
import './globals.css';
import './operations.css';
import './meeting.css';
import './next-phase.css';
import { TimeProvider } from '@/components/time-provider';
import { AppInstall } from '@/components/app-install';
import { ToastProvider } from '@/components/primitives/toast';
import { siteOrigin } from '@/lib/site';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f8f4',
};

const description =
  'Your fitness studio, connected. Live video coaching, on-device form tracking, memberships, classes and progress in one place.';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: { default: 'Geez Squad — Stronger, together.', template: '%s · Geez Squad' },
  description,
  applicationName: 'Geez Squad',
  icons: { icon: '/icon.svg', apple: '/pwa/icon-192.png' },
  appleWebApp: { capable: true, title: 'Geez Squad', statusBarStyle: 'default' },
  openGraph: {
    type: 'website',
    siteName: 'Geez Squad',
    title: 'Geez Squad — Stronger, together.',
    description,
    url: '/',
  },
  twitter: { card: 'summary_large_image', title: 'Geez Squad', description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <ToastProvider>
          <TimeProvider>{children}</TimeProvider>
        </ToastProvider>
        <AppInstall />
      </body>
    </html>
  );
}
