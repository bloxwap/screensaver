import { lazy, Suspense, useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { QRCodeSVG } from 'qrcode.react';
import { BrandWordmark } from './bloxwap/BrandWordmark';
import { InstallDialog, type InstallPrompt } from './components/InstallDialog';
import { ASSET, feedStatus } from './market/model';
import { useMarket } from './market/use-market';
import { useDisplay } from './use-display';

const LiveChart = lazy(() => import('./components/LiveChart').then((module) => ({ default: module.LiveChart })));
const STATUS_LABEL = { live: 'Live', connecting: 'Connecting', stale: 'Price delayed', offline: 'Offline', reconnecting: 'Reconnecting' };

export default function App() {
  const market = useMarket();
  const display = useDisplay();
  const [minutes, setMinutes] = useState(0);
  const [installOpen, setInstallOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const status = feedStatus(market, display.now, display.online);
  const live = status === 'live';
  const price = market.quote?.price;

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed); };
  }, []);

  return <main className={`screensaver ${live ? 'is-live' : 'is-waiting'} ${display.controls || installOpen ? 'controls-visible' : ''} ${display.automatic ? 'automatic' : ''}`}>
    <h1 className="sr-only">Bloxwap Bitcoin screensaver</h1>
    <div className="grid-bg" aria-hidden="true" />
    <div className="brand-watermark"><BrandWordmark capHeight={36} letters="currentColor" x="currentColor" /></div>
    <Suspense fallback={<div className="chart-region" />}><LiveChart points={market.points} quote={market.quote} windowMinutes={minutes} live={live} now={display.now} /></Suspense>

    <header className="masthead">
      <div className="price-pill" aria-label="Current Bitcoin price">
        <img src={`${import.meta.env.BASE_URL}brand/BTC.svg`} width="36" height="36" alt="Bitcoin" />
        <div className="price-readout" data-testid="price" aria-label={price !== undefined ? `Bitcoin ${price.toFixed(2)} US dollars` : 'Waiting for Bitcoin price'}>
          <span aria-hidden="true">{price !== undefined ? <NumberFlow value={price} locales="en-US" format={{ style: 'currency', currency: 'USD' }} transformTiming={{ duration: 300, easing: 'ease-in-out' }} /> : '—'}</span>
        </div>
      </div>
      <div className="connection" role="status" aria-live="polite"><span className="connection-light" /><span>{STATUS_LABEL[status]}</span><span className="connection-source">Hyperliquid</span></div>
    </header>

    <div className="market-notes">
      {!live && market.quote && <span className="stale-label">Last update {new Date(market.quote.time).toLocaleTimeString('en-US', { hour12: false })}</span>}
      {market.historyError && <span className="history-note">History unavailable · collecting live prices</span>}
    </div>

    <footer className="qr-block">
      <div className="qr-caption"><BrandWordmark capHeight={16} /><span>Open Bitcoin <span aria-hidden="true">↗</span></span></div>
      <a href={ASSET.url} target="_blank" rel="noreferrer" aria-label="Open Bitcoin on Bloxwap" className="qr-link"><QRCodeSVG value={ASSET.url} size={88} marginSize={4} level="M" bgColor="#fafafa" fgColor="#0a0a0a" title="Open Bitcoin on Bloxwap" /></a>
    </footer>

    {!display.automatic && <nav className="display-controls" aria-label="Screensaver controls">
      <div className="time-controls" role="group" aria-label="Chart time window">{[0, 5, 15, 60].map((value) => <button key={value} onClick={() => setMinutes(value)} aria-pressed={minutes === value}>{value === 0 ? 'Live' : value === 60 ? '1H' : `${value}M`}</button>)}</div>
      <span className="control-divider" />
      <button onClick={() => setInstallOpen(true)} aria-haspopup="dialog">{window.screensaver ? 'Settings' : 'Install'} <span aria-hidden="true">↓</span></button>
      {'wakeLock' in navigator && <button className="awake-button" aria-label="Keep screen awake" title="Keep screen awake" aria-pressed={display.awake} onClick={() => display.setAwake(!display.awake)}><span className="awake-label">Keep awake</span><svg className="awake-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg><span className="toggle-dot" /></button>}
      <button onClick={() => void display.toggleFullscreen()} aria-label={display.fullscreen ? 'Exit full screen' : 'Enter full screen'} title="Full screen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg></button>
    </nav>}
    {display.message && <div className="toast" role="status">{display.message}<button onClick={() => display.setMessage('')} aria-label="Dismiss message">×</button></div>}
    {installOpen && <InstallDialog onClose={() => setInstallOpen(false)} prompt={prompt} onPromptUsed={() => setPrompt(null)} />}
  </main>;
}
