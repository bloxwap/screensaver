import { useEffect, useRef } from 'react';
import { createChart, type Chart } from '@bloxwap/chart';
import { tickStep, type PricePoint, type Quote } from '../market/model';

function indexAtTime(points: PricePoint[], time: number, interval: number): number {
  if (time < points[0].time) return (time - points[0].time) / interval;
  const last = points.length - 1;
  if (time >= points[last].time) return last + (time - points[last].time) / interval;
  let lo = 0, hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].time <= time) lo = mid; else hi = mid;
  }
  return lo + (time - points[lo].time) / (points[hi].time - points[lo].time);
}

export function LiveChart({ points, quote, windowMinutes, live, now }: {
  points: PricePoint[]; quote: Quote | null; windowMinutes: number; live: boolean; now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const latest = useRef({ points, quote, windowMinutes, live, now });
  latest.current = { points, quote, windowMinutes, live, now };
  const paintRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current!;
    const overlay = overlayRef.current!;
    const host = canvas.parentElement!;
    const chart = createChart({
      container: canvas, preset: 'bloxwapDark',
      config: {
        series: { type: 'line', lineColor: '#00ff3f', lineWidth: 2 },
        theme: { background: '#101010', textColor: '#757575', borderColor: '#101010', monoFamily: 'Bloxwap Mono, monospace' },
        priceAxis: { visible: false, labels: { lastPrice: false, highLow: false, indicator: false, countdown: false }, lines: { lastPrice: false, previousClose: false, highLow: false } },
        timeAxis: { visible: false },
        timeScale: { continuous: true, intervalMs: 1_000 },
        grid: { visible: false }, crosshair: { visible: false },
        statusLine: { visible: false }, watermark: { visible: false },
      },
    });
    chartRef.current = chart;
    const labels = Array.from({ length: 15 }, () => {
      const label = document.createElement('span');
      label.className = 'ruler-tick';
      overlay.append(label);
      return label;
    });
    const dot = document.createElement('span');
    dot.className = 'chart-dot';
    overlay.append(dot);
    const paint = () => {
      const { points, quote, windowMinutes, live, now } = latest.current;
      if (!points.length || host.clientHeight === 0) return;
      const width = host.clientWidth, height = host.clientHeight;
      const color = live ? '#00ff3f' : '#777777';
      const price = quote?.price ?? points.at(-1)!.close;
      const end = now / 1_000;
      const span = windowMinutes * 60;
      // The SDK's minimum slot width is 0.5px. Bucket actual observations so the entire
      // selected time window fits even on a phone, without stretching sparse history.
      const interval = Math.max(1, Math.ceil(span * 1.12 / Math.max(width, 1)));
      const buckets = new Map<number, PricePoint>();
      for (const point of points) {
        const time = Math.floor(point.time / interval) * interval;
        buckets.set(time, { ...point, time });
      }
      const sampled = [...buckets.values()];
      // The last price is pinned vertically, just like an aircraft's altitude tape.
      chart.batch(() => {
        chart.updateConfig({ series: { lineColor: color }, priceAxis: { autoScale: true, lockPriceToBarRatio: false }, timeScale: { intervalMs: interval * 1_000 } });
        chart.setData(sampled);
        chart.scale.zoomToRange(indexAtTime(sampled, end - span, interval), indexAtTime(sampled, end + span * 0.12, interval));
      });
      const visible = sampled.filter((point) => point.time >= end - span - 60);
      const halfSpan = Math.max(10, ...visible.map((point) => Math.abs(point.close - price))) * 1.15;
      const fullSpan = Math.abs(chart.scale.yToPrice(0) - chart.scale.yToPrice(height));
      if (fullSpan > 0) chart.updateConfig({ priceAxis: { lockPriceToBarRatio: true, priceToBarRatio: chart.scale.priceToBarRatio() * (halfSpan * 2 / fullSpan) } });
      const y = chart.scale.priceToY(price);
      if (Number.isFinite(y)) chart.scale.scrollPrice(height / 2 - y);
      const min = chart.scale.yToPrice(height), max = chart.scale.yToPrice(0);
      const step = tickStep(Math.abs(max - min));
      const first = Math.ceil(min / step) * step;
      labels.forEach((label, i) => {
        const value = first + i * step;
        const top = chart.scale.priceToY(value);
        label.hidden = value > max || !Number.isFinite(top) || Math.abs(top - height / 2) < 18;
        label.style.transform = `translateY(${top}px)`;
        label.textContent = value.toLocaleString('en-US', { maximumFractionDigits: 0 });
      });
      const x = chart.scale.indexToX(sampled.length - 1);
      dot.style.transform = `translate(${Math.min(width, Math.max(0, x))}px, ${height / 2}px)`;
      dot.style.backgroundColor = color;
      dot.hidden = !quote || x < 0 || x > width;
    };
    paintRef.current = paint;
    const resize = () => {
      chart.resize(host.clientWidth, host.clientHeight, Math.min(window.devicePixelRatio || 1, 2));
      paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    void document.fonts.ready.then(() => { if (chartRef.current === chart) paint(); });
    return () => {
      observer.disconnect();
      chartRef.current = null;
      paintRef.current = () => {};
      chart.destroy();
      overlay.replaceChildren();
    };
  }, []);

  useEffect(() => { paintRef.current(); }, [points, quote, windowMinutes, live, now]);

  return (
    <section className="chart-region" aria-label={`Bitcoin price chart, last ${windowMinutes} minutes`}>
      <div className="chart-reference" aria-hidden="true" />
      <div className="chart-plot">
        <canvas ref={canvasRef} aria-label="Live Bitcoin price history" role="img" />
        <div ref={overlayRef} className="chart-overlay" aria-hidden="true" />
      </div>
      <span className="current-marker" aria-hidden="true">{quote ? quote.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</span>
      {!points.length && <span className="chart-empty">Waiting for market data</span>}
      <div className="chart-times" aria-hidden="true"><span>−{windowMinutes} MIN</span><span>NOW</span></div>
    </section>
  );
}
