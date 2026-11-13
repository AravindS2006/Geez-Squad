import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { Inter, Instrument_Serif } from 'next/font/google';
import './tokens.css';
import './globals.css';
import './operations.css';
import './meeting.css';
import './next-phase.css';
import './theme.css';
import { TimeProvider } from '@/components/time-provider';
import { AppInstall } from '@/components/app-install';
import { ClientErrorReporter } from '@/components/client-error-reporter';
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
  themeColor: '#f7f7f5',
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The nonce CSP from src/proxy.ts only works on per-request renders: Next.js stamps the nonce
  // from the request header onto its scripts, and a prerendered page has none. Waiting for the
  // request opts every page out of static prerendering.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <ToastProvider>
          <TimeProvider>{children}</TimeProvider>
        </ToastProvider>
        <AppInstall />
        <ClientErrorReporter />
      </body>
    </html>
  );
}
