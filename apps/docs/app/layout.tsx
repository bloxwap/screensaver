import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BloxwapSans } from '@bloxwap/font/sans';
import { BloxwapMono } from '@bloxwap/font/mono';
import { Provider } from '@/components/provider';
import { asset, canonical } from '@/lib/site';
import './global.css';

const description = 'Live Bitcoin, Solana, Ethereum, and Hyperliquid screensavers for Mac, Windows, and Linux. Pick an asset, download your edition, or preview it in your browser.';

export const metadata: Metadata = {
  metadataBase: new URL(canonical('/')),
  title: { default: 'Screensaver · Bloxwap', template: '%s · Bloxwap Screensaver' },
  description,
  alternates: { canonical: canonical('/') },
  icons: { icon: asset('/logos/bloxwap-icon-green.svg') },
  openGraph: {
    title: 'Screensaver · Bloxwap', description, siteName: 'Bloxwap Screensaver',
    type: 'website', url: canonical('/'),
    images: [{ url: canonical('/icon-512.png'), width: 512, height: 512, alt: 'Bloxwap Screensaver' }],
  },
  twitter: { card: 'summary', title: 'Screensaver · Bloxwap', description, images: [canonical('/icon-512.png')] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${BloxwapSans.variable} ${BloxwapMono.variable} dark`} suppressHydrationWarning><body className="flex min-h-screen flex-col antialiased"><Provider>{children}</Provider></body></html>;
}
