import type { Metadata } from 'next';
import './globals.css';
import './operations.css';
import { TimeProvider } from '@/components/time-provider';
export const metadata: Metadata = {
  title: 'Geez Squad — Stronger, together.',
  description:
    'Your fitness studio, connected. Memberships, classes, personal coaching, and a community that moves you forward.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TimeProvider>{children}</TimeProvider>
      </body>
    </html>
  );
}
