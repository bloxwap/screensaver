import { useEffect, useRef, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { createChart, createSeriesRegistry, type Chart, type SeriesDrawFn } from '@bloxwap/chart';
import { FLOW_PX_PER_SEC, TICK_PX, labelDecimalsFor, tickSpacingFor, writeSmoothPath } from '../bloxwap/chart-math';
import { advanceChartPresentation, createChartPresentation } from './chart-presentation';
import { BrandWordmark } from '../bloxwap/BrandWordmark';
import { DEFAULT_ASSET, type Asset } from '../assets';
import type { PricePoint, Quote } from '../market/model';

// Keep the trading screen's edge scale; reserve the measured width of the larger readout.
const EDGE = 18;

export function LiveChart({ asset = DEFAULT_ASSET, points, quote, windowMinutes, live, now }: {
  asset?: Asset; points: PricePoint[]; quote: Quote | null; windowMinutes: number; live: boolean; now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [readoutPrice, setReadoutPrice] = useState<number | null>(null);
  const latest = useRef({ quote, windowMinutes, live, now });
  latest.current = { quote, windowMinutes, live, now };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = canvas.parentElement!;
    const marker = markerRef.current!;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = host.clientWidth, height = host.clientHeight;
    let markerWidth = marker.offsetWidth, markerHeight = marker.offsetHeight;
    let density = 1;
    const presentation = createChartPresentation();
    const draw: SeriesDrawFn = (ctx, candles) => {
      if (document.hidden) return;
      ctx.clearRect(0, 0, width, height);
      const { quote, windowMinutes, live, now } = latest.current;
      const price = quote?.price ?? candles.at(-1)?.close;
      if (price === undefined) return;
      const frameTime = performance.now();
      if (quote) {
        const sampledPrice = advanceChartPresentation(presentation, price, frameTime, live ? Date.now() : quote.time, live, motion.matches);
        setReadoutPrice(sampledPrice);
      }
      const shownPrice = quote ? presentation.value : price;
      const centerY = height / 2;
      // NumberFlow can change the pill's width between React commits.
      markerWidth = marker.getBoundingClientRect().width;
      markerHeight = marker.offsetHeight;
      const trailEnd = Math.max(EDGE + 40, width - 8 - markerWidth + 1);
      const end = quote ? presentation.time : now;
      const tickPixels = TICK_PX * density;
      const pxPerSecond = windowMinutes ? (trailEnd - EDGE) / (windowMinutes * 60) : FLOW_PX_PER_SEC * density;
      const start = end - (trailEnd - EDGE) / pxPerSecond * 1_000;
      // Retain the observation immediately before the viewport for a continuous entry.
      // Replace the recent raw-price segment with the eased 200ms trail, as in the app.
      // Older observations still supply the extended history windows.
      const samples = presentation.ticks;
      const sampleStart = samples.length ? Math.floor(samples[0].t / 1_000) * 1_000 : Infinity;
      const trail = [
        ...candles.filter((point) => point.time * 1_000 < sampleStart).map((point) => ({ t: point.time * 1_000, p: point.close })),
        ...samples,
      ];
      let first = trail.findIndex((point) => point.t >= start);
      first = first < 0 ? Math.max(0, trail.length - 1) : Math.max(0, first - 1);
      const visible = trail.slice(first);
      let spacing = tickSpacingFor(shownPrice);
      if (windowMinutes) {
        // Longer history remains readable while retaining the same 44px price tape.
        const halfRange = Math.max(spacing, ...visible.map((point) => Math.abs(point.p - shownPrice)));
        spacing = Math.max(spacing, Math.ceil(halfRange * 2.3 / height * tickPixels * 100) / 100);
      }
      const yFor = (value: number) => centerY - (value - shownPrice) / spacing * tickPixels;
      const xFor = (time: number) => trailEnd - (end - time) / 1_000 * pxPerSecond;
      const anchor = Math.round(shownPrice / spacing) * spacing;
      const rows = Math.ceil(height / (2 * tickPixels)) + 1;
      const decimals = labelDecimalsFor(spacing, shownPrice);
      ctx.font = `${13 * density}px "Bloxwap Mono", monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(161,161,161,0.35)';
      ctx.fillStyle = 'rgba(161,161,161,0.75)';
      ctx.beginPath();
      for (let i = -rows; i <= rows; i++) {
        const value = anchor + i * spacing;
        const y = yFor(value);
        ctx.moveTo(EDGE - 8, y); ctx.lineTo(EDGE, y);
        ctx.moveTo(width - EDGE, y); ctx.lineTo(width - EDGE + 8, y);
        if (Math.abs(y - centerY) > markerHeight / 2 + 12) ctx.fillText(value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }), width - 32, y);
      }
      ctx.stroke();
      const tipY = yFor(shownPrice);
      marker.style.top = `${tipY}px`;
      const path: [number, number][] = visible.map((point) => [xFor(point.t), yFor(point.p)]);
      const distinct = path.filter((point, index) => index === 0 || point[0] > path[index - 1][0]);
      if (!distinct.length) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(EDGE, 0, trailEnd - EDGE, height); ctx.clip();
      // This renderer is installed on our browser canvas; the SDK's portable context
      // interface omits gradients used by the web trading screen.
      const gradient = (ctx as CanvasRenderingContext2D).createLinearGradient(EDGE, 0, trailEnd, 0);
      const rgb = live ? '0,255,63' : '161,161,161';
      gradient.addColorStop(0, `rgba(${rgb},0)`);
      gradient.addColorStop(1, `rgba(${rgb},1)`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      writeSmoothPath(distinct, {
        moveTo: (x, y) => ctx.moveTo(x, y),
        lineTo: (x, y) => ctx.lineTo(x, y),
        cubicTo: (a, b, c, d, x, y) => ctx.bezierCurveTo(a, b, c, d, x, y),
      });
      if (quote) {
        const [x, y] = distinct.at(-1)!;
        const dx = Math.max(0, trailEnd - x);
        ctx.bezierCurveTo(x + dx / 3, y, trailEnd - dx / 3, tipY, trailEnd, tipY);
      }
      ctx.stroke();
      ctx.restore();
    };
    const chart = createChart({
      container: canvas, preset: 'bloxwapDark', crosshairCache: false,
      registries: { series: createSeriesRegistry().register('altimeter', draw) },
      config: {
        series: { type: 'altimeter' },
        theme: { background: 'transparent', monoFamily: 'Bloxwap Mono, monospace' },
        priceAxis: { visible: false, labels: { lastPrice: false, highLow: false, indicator: false, countdown: false }, lines: { lastPrice: false, previousClose: false, highLow: false } },
        timeAxis: { visible: false }, grid: { visible: false }, crosshair: { visible: false },
        statusLine: { visible: false }, watermark: { visible: false },
      },
    });
    chartRef.current = chart;
    const resize = () => {
      width = host.clientWidth; height = host.clientHeight;
      markerWidth = marker.offsetWidth; markerHeight = marker.offsetHeight;
      density = Number(getComputedStyle(host).getPropertyValue('--chart-scale')) || 1;
      chart.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    observer.observe(marker);
    resize();
    let frame = 0, lastFrame = 0;
    const animate = (time: number) => {
      // Continuous flow is capped at 30fps; hidden views do no canvas work.
      if (!document.hidden && !motion.matches && time - lastFrame >= 1_000 / 30) {
        chart.render(); lastFrame = time;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const resetAnimation = () => {
      presentation.value = NaN;
      if (!document.hidden) chart.render();
    };
    document.addEventListener('visibilitychange', resetAnimation);
    motion.addEventListener('change', resetAnimation);
    void document.fonts.ready.then(() => { if (chartRef.current === chart) chart.render(); });
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', resetAnimation);
      motion.removeEventListener('change', resetAnimation);
      chartRef.current = null; chart.destroy();
    };
  }, []);

  useEffect(() => { chartRef.current?.setData(points); }, [points]);
  useEffect(() => { chartRef.current?.render(); }, [quote, windowMinutes, live, now]);
  const summary = quote
    ? `${asset.name} ${quote.price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. ${live ? 'Live Hyperliquid bid/ask midpoint.' : 'Last observed price; feed is not live.'}`
    : `Waiting for a live ${asset.name} price. The trail shows available price observations.`;
  return <section className="chart-region" aria-label={`${asset.name} price chart, ${windowMinutes ? `last ${windowMinutes} minutes` : 'live view'}`} aria-describedby="chart-summary">
    <p id="chart-summary" className="sr-only">{summary}</p>
    <div className="brand-watermark"><BrandWordmark capHeight={36} letters="currentColor" x="currentColor" /></div>
    <div className="chart-plot"><canvas ref={canvasRef} aria-label={`${asset.name} price trail and altitude scale`} role="img" /></div>
    <div ref={markerRef} className="current-marker" data-testid="price" role="img" aria-label={quote ? `${asset.name} ${quote.price.toFixed(2)} US dollars` : `Waiting for ${asset.name} price`}>
      <span aria-hidden="true">{quote ? <NumberFlow value={readoutPrice ?? quote.price} locales="en-US" format={{ style: 'currency', currency: 'USD' }} transformTiming={{ duration: 300, easing: 'ease-in-out' }} /> : '—'}</span>
    </div>
    {!points.length && <span className="chart-empty">Waiting for market data</span>}
  </section>;
}
