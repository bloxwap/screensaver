import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Downloads, type ReleaseManifest } from '@/components/downloads';
import { SiteFooter } from '@/components/site-footer';
import { layoutOptions } from '@/lib/site';
import assets from '../../../config/assets.json';
import releases from '../../../config/releases.json';
import './landing.css';

export default function Home() {
  return <HomeLayout {...layoutOptions()}>
    <main className="screensaver-home">
      <section className="landing-hero" aria-labelledby="screensaver-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><span className="landing-status-dot" aria-hidden="true" />Bloxwap / Screensaver</p>
          <h1 id="screensaver-title">Your market,<br className="landing-mobile-break" /> in motion.</h1>
          <p className="landing-description">A live price display for your desktop. Pick your asset, download your screensaver, or open a preview right here.</p>
        </div>
        <div className="landing-hero-art" aria-hidden="true">
          <svg viewBox="0 0 320 160" fill="none"><defs><pattern id="landing-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M14 16h4m-2-2v4" stroke="currentColor" strokeOpacity=".18" /></pattern><linearGradient id="landing-trail" x1="15" y1="80" x2="285" y2="80" gradientUnits="userSpaceOnUse"><stop stopColor="currentColor" stopOpacity="0" /><stop offset="1" stopColor="currentColor" /></linearGradient></defs><rect width="320" height="160" fill="url(#landing-grid)" /><path d="M5 118c20 0 20-29 40-29s20 16 40 16 20-46 40-46 20 20 40 20 20-39 40-39 20 30 40 30h40" stroke="url(#landing-trail)" strokeWidth="2.5" strokeLinecap="round" /><circle cx="285" cy="70" r="4" fill="currentColor" /><path d="M285 14v132" stroke="currentColor" strokeOpacity=".15" strokeDasharray="2 6" /></svg>
        </div>
      </section>

      <Downloads assets={assets} manifest={releases as ReleaseManifest} />

      <section className="landing-details" aria-label="About the screensaver">
        <div><span className="landing-detail-number">01</span><h2>A screen with room to breathe.</h2><p>A full-screen chart, a moving price, and a quiet grid. The same display in your browser and on your desktop.</p></div>
        <div><span className="landing-detail-number">02</span><h2>On your schedule.</h2><p>Open it whenever you like, or enable automatic idle activation in the desktop app. Your sleep and lock settings stay in place.</p></div>
        <Link href="/docs/" className="landing-docs-link"><span>Settle in.</span><strong>Read the guide <span aria-hidden="true">↗</span></strong></Link>
      </section>
    </main>
    <SiteFooter />
  </HomeLayout>;
}
