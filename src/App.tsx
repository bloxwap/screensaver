import { lazy, Suspense, useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { QRCodeSVG } from 'qrcode.react';
import { InstallDialog, type InstallPrompt } from './components/InstallDialog';
import { ASSET, feedStatus } from './market/model';
import { useMarket } from './market/use-market';
import { useDisplay } from './use-display';

const PRICE_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const LiveChart = lazy(() => import('./components/LiveChart').then((module) => ({ default: module.LiveChart })));
const STATUS_LABEL = { live: 'LIVE', connecting: 'CONNECTING', stale: 'PRICE DELAYED', offline: 'OFFLINE', reconnecting: 'RECONNECTING' };
const compact = (value: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);

export default function App() {
  const market = useMarket();
  const display = useDisplay();
  const [minutes, setMinutes] = useState(15);
  const [installOpen, setInstallOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const status = feedStatus(market, display.now, display.online);
  const live = status === 'live';
  const price = market.quote?.price;
  const change = price && market.previousDay ? (price / market.previousDay - 1) * 100 : null;

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed); };
  }, []);

  return <main className={`screensaver ${live ? 'is-live' : 'is-waiting'} ${display.controls || installOpen ? 'controls-visible' : ''} ${display.automatic ? 'automatic' : ''}`}>
    <header className="masthead">
      <a className="brand" href="https://bloxwap.app" target="_blank" rel="noreferrer" aria-label="Bloxwap">
        <svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round"><path d="M25 75 75 25M24 24 35 35M65 65 76 76" /></g></svg>
        <span>bloxwap</span><span className="brand-divider" /><span className="brand-descriptor">screensaver</span>
      </a>
      <div className="connection" role="status" aria-live="polite"><span className="connection-light" /><span>{STATUS_LABEL[status]}</span><span className="connection-source">HYPERLIQUID</span></div>
    </header>

    <section className="price-stage" aria-label="Current Bitcoin price">
      <div className="asset-label"><span className="bitcoin-symbol" aria-hidden="true">₿</span><h1>Bitcoin</h1><span className="asset-pair">BTC / USD</span></div>
      <div className="price-readout" data-testid="price" aria-label={price ? `Bitcoin ${price.toFixed(2)} US dollars` : 'Waiting for Bitcoin price'}>
        <span className="currency-symbol" aria-hidden="true">$</span>
        {price !== undefined ? <NumberFlow value={price} locales="en-US" format={PRICE_FORMAT} transformTiming={{ duration: 600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }} /> : <span className="price-placeholder">—<span className="placeholder-decimals">.——</span></span>}
      </div>
      <div className="price-context">
        {change !== null && <span className={`day-change ${change < 0 ? 'negative' : ''}`}>{change >= 0 ? '↗' : '↘'} {Math.abs(change).toFixed(2)}% <span>past 24h</span></span>}
        {!live && <span className="stale-label">{market.quote ? `Last update ${new Date(market.quote.time).toLocaleTimeString('en-US', { hour12: false })}` : 'Connecting to the market'}</span>}
        {live && change === null && <span className="stale-label">LIVE MID PRICE</span>}
      </div>
    </section>

    <Suspense fallback={<div className="chart-region" />}><LiveChart points={market.points} quote={market.quote} windowMinutes={minutes} live={live} now={display.now} /></Suspense>

    <footer className="footer">
      <div className="market-caption"><div className="caption-top"><span className="mini-cross">✳</span> THE MARKET NEVER SLEEPS.</div><div className="caption-details"><time>{new Date(display.now).toLocaleTimeString('en-US', { hour12: false })}</time><span className="caption-dot">·</span><span>{market.dayVolume ? `$${compact(market.dayVolume)} VOLUME / 24H` : 'BITCOIN / PERPETUAL'}</span></div>{market.historyError && <span className="history-note">History unavailable · collecting live prices</span>}</div>
      <div className="qr-block"><div className="qr-caption"><span>Stay in the flow.</span><span>bloxwap.app <span aria-hidden="true">↗</span></span></div><a href={ASSET.url} target="_blank" rel="noreferrer" aria-label="Open Bitcoin on Bloxwap" className="qr-link"><QRCodeSVG value={ASSET.url} size={88} marginSize={4} level="M" bgColor="#ededed" fgColor="#101010" title="Open Bitcoin on Bloxwap" /></a></div>
    </footer>

    {!display.automatic && <nav className="display-controls" aria-label="Screensaver controls">
      <div className="time-controls" role="group" aria-label="Chart time window">{[5, 15, 60].map((value) => <button key={value} onClick={() => setMinutes(value)} aria-pressed={minutes === value}>{value === 60 ? '1H' : `${value}M`}</button>)}</div>
      <span className="control-divider" />
      <button onClick={() => setInstallOpen(true)} aria-haspopup="dialog">{window.screensaver ? 'Settings' : 'Install'} <span aria-hidden="true">↓</span></button>
      {'wakeLock' in navigator && <button className="awake-button" aria-label="Keep screen awake" title="Keep screen awake" aria-pressed={display.awake} onClick={() => display.setAwake(!display.awake)}><span className="awake-label">Keep awake</span><span className="awake-icon" aria-hidden="true">☼</span><span className="toggle-dot" /></button>}
      <button onClick={() => void display.toggleFullscreen()} aria-label={display.fullscreen ? 'Exit full screen' : 'Enter full screen'} title="Full screen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg></button>
    </nav>}
    {display.message && <div className="toast" role="status">{display.message}<button onClick={() => display.setMessage('')} aria-label="Dismiss message">×</button></div>}
    {installOpen && <InstallDialog onClose={() => setInstallOpen(false)} prompt={prompt} onPromptUsed={() => setPrompt(null)} />}
  </main>;
}
