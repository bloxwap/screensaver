import type { Candle } from '@bloxwap/chart';
import { DEFAULT_ASSET, type AssetSymbol } from '../assets';

/** Compatibility for callers that have not yet selected an edition. */
export const ASSET = { ...DEFAULT_ASSET, url: DEFAULT_ASSET.tradeUrl } as const;
export const HISTORY_MS = 60 * 60_000;
export const STALE_MS = 15_000;
export const MAX_POINTS = 3_700;

export type Quote = { price: number; time: number; receivedAt: number };
export type PricePoint = Candle & { source: 'history' | 'live' };
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type FeedStatus = 'connecting' | 'live' | 'stale' | 'offline' | 'reconnecting';
export type MarketSnapshot = {
  quote: Quote | null;
  points: PricePoint[];
  previousDay: number | null;
  dayVolume: number | null;
  connection: Connection;
  connectedAt: number;
  historyError: boolean;
};

export const initialSnapshot = (): MarketSnapshot => ({
  quote: null, points: [], previousDay: null, dayVolume: null,
  connection: 'connecting', connectedAt: 0, historyError: false,
});

export function positive(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Use the same unrounded best-bid / best-ask midpoint as the Bloxwap live chart. */
export function bookQuote(book: {
  coin: string; time: number; levels: [{ px: string }[], { px: string }[]];
}, now: number, previous: Quote | null, symbol: AssetSymbol = DEFAULT_ASSET.symbol): Quote | null {
  const bid = positive(book.levels[0][0]?.px);
  const ask = positive(book.levels[1][0]?.px);
  if (book.coin !== symbol || bid === null || ask === null || bid > ask) return null;
  if (!Number.isFinite(book.time) || book.time <= 0 || book.time > now + 5_000) return null;
  if (previous && book.time <= previous.time) return null;
  return { price: (bid + ask) / 2, time: book.time, receivedAt: now };
}

export function toPoint(time: number, price: number, source: PricePoint['source']): PricePoint {
  return { time: Math.floor(time / 1_000), open: price, high: price, low: price, close: price, source };
}

/** One point per second; bounded storage even when the display runs for weeks. */
export function mergePoints(history: PricePoint[], live: PricePoint[], now: number): PricePoint[] {
  const points = new Map<number, PricePoint>();
  for (const point of [...history, ...live]) {
    if (point.time < (now - HISTORY_MS) / 1_000 || point.time > now / 1_000 + 5) continue;
    if (!Number.isFinite(point.time) || positive(point.close) === null) continue;
    const existing = points.get(point.time);
    if (existing?.source === 'live' && point.source === 'history') continue;
    points.set(point.time, point);
  }
  return [...points.values()].sort((a, b) => a.time - b.time).slice(-MAX_POINTS);
}

export function candlePoints(candles: { t: number; T: number; c: string; s: string }[], now: number, symbol: AssetSymbol = DEFAULT_ASSET.symbol): PricePoint[] {
  return candles.flatMap((candle) => {
    const close = positive(candle.c);
    // Only closed candles have a known closing time. Never date an unfinished candle into the future.
    if (candle.s !== symbol || close === null || !Number.isFinite(candle.t) || !Number.isFinite(candle.T) || candle.T > now || candle.T < candle.t) return [];
    return [toPoint(candle.T, close, 'history')];
  });
}

export function feedStatus(snapshot: MarketSnapshot, now: number, online: boolean): FeedStatus {
  if (!online) return 'offline';
  if (snapshot.connection === 'disconnected' || snapshot.connection === 'reconnecting') return 'reconnecting';
  if (snapshot.connection === 'connecting') return 'connecting';
  const quote = snapshot.quote;
  if (!quote) return 'connecting';
  if (quote.receivedAt < snapshot.connectedAt || now - quote.time > STALE_MS || now - quote.receivedAt > STALE_MS) return 'stale';
  return 'live';
}
