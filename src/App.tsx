import { lazy, Suspense, useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { QRCodeSVG } from 'qrcode.react';
import { InstallDialog, type InstallPrompt } from './components/InstallDialog';
import { getAsset, type Asset } from './assets';
import { feedStatus } from './market/model';
import { useMarket } from './market/use-market';
import { useDisplay } from './use-display';

const LiveChart = lazy(() => import('./components/LiveChart').then((module) => ({ default: module.LiveChart })));
const STATUS_LABEL = { live: 'Live', connecting: 'Connecting', stale: 'Price delayed', offline: 'Offline', reconnecting: 'Reconnecting' };

export default function App() {
  const [asset, setAsset] = useState(() => getAsset(new URLSearchParams(location.search).get('asset')));

  useEffect(() => {
    const selectAsset = () => setAsset(getAsset(new URLSearchParams(location.search).get('asset')));
    window.addEventListener('popstate', selectAsset);
    return () => window.removeEventListener('popstate', selectAsset);
  }, []);

  // Recreate display state when browser navigation changes editions, including the
  // eased chart trail, so a previous asset's readout cannot flash under a new name.
  return <AssetScreensaver key={asset.symbol} asset={asset} />;
}

function AssetScreensaver({ asset }: { asset: Asset }) {
  const market = useMarket(asset);
  const display = useDisplay();
  const [minutes, setMinutes] = useState(0);
  const [installOpen, setInstallOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const status = feedStatus(market, display.now, display.online);
  const live = status === 'live';
  const browserPreview = !window.screensaver;
  const downloadsUrl = /\/preview\/(?:index\.html)?$/.test(location.pathname)
    ? new URL('../', location.href).href
    : 'https://bloxwap.github.io/screensaver/';

  useEffect(() => { document.title = `Bloxwap Screensaver · ${asset.name}`; }, [asset.name]);

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed); };
  }, []);

  return <main className={`screensaver ${live ? 'is-live' : 'is-waiting'} ${display.controls || installOpen ? 'controls-visible' : ''} ${display.automatic ? 'automatic' : ''} ${browserPreview ? 'browser-preview' : ''}`} data-asset={asset.symbol}>
    <h1 className="sr-only">Bloxwap {asset.name} screensaver</h1>
    <div className="grid-bg" aria-hidden="true" />
    <Suspense fallback={<div className="chart-region" />}><LiveChart asset={asset} points={market.points} quote={market.quote} windowMinutes={minutes} live={live} now={display.now} /></Suspense>

    <header className="masthead">
      <div className="asset-pill" role="group" aria-label={market.quote ? `${asset.name} ${market.quote.price.toFixed(2)} US dollars` : `${asset.name}, waiting for price`}>
        <img src={`${import.meta.env.BASE_URL}${asset.icon}`} width="36" height="36" alt="" />
        <span className="asset-symbol" aria-hidden="true">{asset.name}</span>
        <span className="asset-price" data-testid="header-price" data-price={market.quote?.price.toFixed(2) ?? ''} aria-hidden="true">{market.quote ? <NumberFlow value={market.quote.price} locales="en-US" format={{ style: 'currency', currency: 'USD' }} transformTiming={{ duration: 300, easing: 'ease-in-out' }} /> : '—'}</span>
      </div>
      <div className="connection" role="status" aria-live="polite"><span className="connection-light" /><span className="connection-status">{STATUS_LABEL[status]}</span><span className="connection-source">Hyperliquid</span></div>
    </header>

    {browserPreview && <a className="preview-return" href={downloadsUrl} aria-label="Back to screensaver downloads"><span aria-hidden="true">←</span> Downloads</a>}

    <div className="market-notes">
      {!live && market.quote && <span className="stale-label">Last update {new Date(market.quote.time).toLocaleTimeString('en-US', { hour12: false })}</span>}
      {market.historyError && <span className="history-note">History unavailable · collecting live prices</span>}
    </div>

    <footer className="qr-block">
      <a href={asset.tradeUrl} target="_blank" rel="noreferrer" aria-label={`Open ${asset.name} on Bloxwap`} className="qr-link">
        <span className="qr-code"><QRCodeSVG value={asset.tradeUrl} size={410} marginSize={2} level="Q" boostLevel={false} bgColor="#0a0a0a" fgColor="#ffffff" title={`Open ${asset.name} on Bloxwap`} /></span>
        <span className="qr-copy"><strong>Trade {asset.symbol} on Bloxwap <span aria-hidden="true">↗</span></strong><span>The easiest way to trade.</span></span>
      </a>
    </footer>

    {!display.automatic && <nav className="display-controls" aria-label="Screensaver controls">
      <div className="time-controls" role="group" aria-label="Chart time window">{[0, 5, 15, 60].map((value) => <button key={value} onClick={() => setMinutes(value)} aria-pressed={minutes === value}>{value === 0 ? 'Live' : value === 60 ? '1H' : `${value}M`}</button>)}</div>
      <span className="control-divider" />
      <button onClick={() => setInstallOpen(true)} aria-haspopup="dialog">{window.screensaver ? 'Settings' : 'Install'} <span aria-hidden="true">↓</span></button>
      {'wakeLock' in navigator && <button className="awake-button" aria-label="Keep screen awake" title="Keep screen awake" aria-pressed={display.awake} onClick={() => display.setAwake(!display.awake)}><span className="awake-label">Keep awake</span><svg className="awake-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg><span className="toggle-dot" /></button>}
      <button onClick={() => void display.toggleFullscreen()} aria-label={display.fullscreen ? 'Exit full screen' : 'Enter full screen'} title="Full screen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg></button>
    </nav>}
    {display.message && <div className="toast" role="status">{display.message}<button onClick={() => display.setMessage('')} aria-label="Dismiss message">×</button></div>}
    {installOpen && <InstallDialog asset={asset} onClose={() => setInstallOpen(false)} prompt={prompt} onPromptUsed={() => setPrompt(null)} />}
  </main>;
}
