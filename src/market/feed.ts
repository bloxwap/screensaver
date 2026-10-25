import { HttpTransport } from '@bloxwap/hyperliquid/transport/http';
import { WebSocketTransport } from '@bloxwap/hyperliquid/transport/websocket';
import { InfoClient } from '@bloxwap/hyperliquid/api/info/client';
import { SubscriptionClient } from '@bloxwap/hyperliquid/api/subscription/client';
import { DEFAULT_ASSET, getAsset, type Asset } from '../assets';
import { HISTORY_MS, bookQuote, candlePoints, initialSnapshot, mergePoints, positive, toPoint, type MarketSnapshot } from './model';

export type FeedServices = {
  info: Pick<InfoClient, 'candleSnapshot'>;
  createTransport: () => WebSocketTransport;
  createSubscriptions: (transport: WebSocketTransport) => Pick<SubscriptionClient, 'l2Book' | 'activeAssetCtx'>;
};

/** One read-only connection shared by the price, chart and market summary. */
export function startMarketFeed(publish: (snapshot: MarketSnapshot) => void, asset: Asset = DEFAULT_ASSET, services: Partial<FeedServices> = {}): () => void {
  const symbol = getAsset(asset.symbol).symbol;
  const abort = new AbortController();
  const info = services.info ?? new InfoClient({ transport: new HttpTransport({ timeout: 10_000 }) });
  const createTransport = services.createTransport ?? (() => new WebSocketTransport());
  const createSubscriptions = services.createSubscriptions ?? ((transport: WebSocketTransport) => new SubscriptionClient({ transport }));
  const state = initialSnapshot();
  let transport: WebSocketTransport | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let historyFlight = false;
  let lastHistoryAttempt = 0;
  let lastRestart = 0;
  let stopped = false;

  const emit = () => { if (!stopped && !document.hidden) publish({ ...state }); };
  async function history() {
    if (historyFlight || stopped) return;
    historyFlight = true;
    lastHistoryAttempt = Date.now();
    try {
      const now = Date.now();
      const candles = await info.candleSnapshot({ coin: symbol, interval: '1m', startTime: now - HISTORY_MS, endTime: now }, { signal: abort.signal });
      if (stopped) return;
      // A slow HTTP response cannot replace more recent WebSocket observations.
      state.points = mergePoints(candlePoints(candles, Date.now(), symbol), state.points.filter((p) => p.source === 'live'), Date.now());
      state.historyError = false;
      emit();
    } catch {
      if (!stopped) { state.historyError = true; emit(); }
    } finally { historyFlight = false; }
  }

  function connect() {
    if (stopped) return;
    clearTimeout(retry);
    const previous = transport;
    transport = null;
    previous?.close();
    const current = createTransport();
    transport = current;
    lastRestart = Date.now();
    state.connection = state.quote ? 'reconnecting' : 'connecting';
    emit();
    const subscriptions = createSubscriptions(current);
    current.events.addEventListener('connectionstatechange', (event) => {
      if (stopped || current !== transport) return;
      state.connection = event.detail;
      if (event.detail === 'connected') {
        state.connectedAt = Date.now();
        void history();
      }
      if (event.detail === 'disconnected') retry = setTimeout(connect, 5_000);
      emit();
    });
    void subscriptions.l2Book({ coin: symbol, fast: true }, (book) => {
      if (stopped || current !== transport) return;
      const quote = bookQuote(book, Date.now(), state.quote, symbol);
      if (!quote) return;
      state.quote = quote;
      state.points = mergePoints(state.points, [toPoint(quote.time, quote.price, 'live')], Date.now());
      emit();
    }).catch(() => {
      if (stopped || current !== transport) return;
      state.connection = 'reconnecting';
      emit();
      clearTimeout(retry);
      retry = setTimeout(connect, 5_000);
    });
    void subscriptions.activeAssetCtx({ coin: symbol }, ({ coin, ctx }) => {
      if (stopped || current !== transport || coin !== symbol) return;
      state.previousDay = positive(ctx.prevDayPx);
      state.dayVolume = positive(ctx.dayNtlVlm);
      emit();
    }).catch(() => {
      // Retry the connection if either subscription could not be established.
      if (stopped || current !== transport) return;
      clearTimeout(retry);
      retry = setTimeout(connect, 5_000);
    });
  }

  const recover = () => {
    if (document.visibilityState === 'hidden' || !navigator.onLine) return;
    emit();
    const age = Date.now() - (state.quote?.receivedAt ?? lastRestart);
    if (age > 30_000 && Date.now() - lastRestart > 30_000) connect();
    if (state.historyError && Date.now() - lastHistoryAttempt > 30_000) void history();
  };
  const monitor = setInterval(recover, 5_000);
  window.addEventListener('online', recover);
  document.addEventListener('visibilitychange', recover);
  connect();
  void history();
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(monitor);
    clearTimeout(retry);
    abort.abort();
    transport?.close();
    window.removeEventListener('online', recover);
    document.removeEventListener('visibilitychange', recover);
  };
}
