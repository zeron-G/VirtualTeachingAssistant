import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Virtual Teaching Assistant',
  description: 'JHU course assistant — grounded answers and live classroom discussion.',
};

export const viewport: Viewport = {
  // The student room is a phone-first, full-height app: it must fill the
  // viewport and sit under the notch rather than being letterboxed.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0e16' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
