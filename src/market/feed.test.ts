import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InfoClient } from '@bloxwap/hyperliquid/api/info/client';
import type { SubscriptionClient } from '@bloxwap/hyperliquid/api/subscription/client';
import type { WebSocketTransport } from '@bloxwap/hyperliquid/transport/websocket';
import { ASSETS, getAsset } from '../assets';
import { startMarketFeed, type FeedServices } from './feed';
import type { MarketSnapshot } from './model';

type Candles = Awaited<ReturnType<InfoClient['candleSnapshot']>>;
type BookListener = Parameters<SubscriptionClient['l2Book']>[1];
type ContextListener = Parameters<SubscriptionClient['activeAssetCtx']>[1];

function browserGlobals() {
  const descriptors = new Map(['window', 'document', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { hidden: false, visibilityState: 'visible' }) });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  return () => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

function fixture() {
  const events = new EventTarget();
  let closes = 0;
  let bookListener: BookListener;
  let contextListener: ContextListener;
  let resolveHistory: (candles: Candles) => void;
  let signal: AbortSignal | undefined;
  const requested: string[] = [];
  const transport = { events, close: () => { closes++; } } as unknown as WebSocketTransport;
  const services: FeedServices = {
    info: { candleSnapshot: (parameters, options) => {
      requested.push(`history:${parameters.coin}`);
      signal = options instanceof AbortSignal ? options : options?.signal;
      return new Promise<Candles>((resolve) => { resolveHistory = resolve; });
    } },
    createTransport: () => transport,
    createSubscriptions: () => ({
      l2Book: async (parameters, listener) => {
        requested.push(`book:${parameters.coin}`);
        bookListener = listener;
        return {} as Awaited<ReturnType<SubscriptionClient['l2Book']>>;
      },
      activeAssetCtx: async (parameters, listener) => {
        requested.push(`context:${parameters.coin}`);
        contextListener = listener;
        return {} as Awaited<ReturnType<SubscriptionClient['activeAssetCtx']>>;
      },
    }),
  };
  return {
    services, requested,
    get closes() { return closes; },
    get signal() { return signal; },
    connected() { events.dispatchEvent(new CustomEvent('connectionstatechange', { detail: 'connected' })); },
    book(coin: string, price: number, time = Date.now()) {
      bookListener({ coin, time, levels: [[{ px: String(price - 0.01), sz: '1', n: 1 }], [{ px: String(price + 0.01), sz: '1', n: 1 }]] });
    },
    context(coin: string) {
      contextListener({ coin, ctx: { prevDayPx: '100', dayNtlVlm: '10000', markPx: '101' } } as Parameters<ContextListener>[0]);
    },
    history(candles: Candles) { resolveHistory(candles); },
  };
}

test('every edition subscribes to its selected market and ignores mismatched book/context events', async (t) => {
  const restore = browserGlobals();
  const stops: (() => void)[] = [];
  t.after(() => { stops.forEach((stop) => stop()); restore(); });
  for (const asset of ASSETS) {
    const fake = fixture();
    const snapshots: MarketSnapshot[] = [];
    const stop = startMarketFeed((snapshot) => snapshots.push(snapshot), asset, fake.services);
    stops.push(stop);
    fake.connected();
    assert.deepEqual(fake.requested, [`book:${asset.symbol}`, `context:${asset.symbol}`, `history:${asset.symbol}`]);
    fake.book(asset.symbol, 123.45);
    assert.equal(snapshots.at(-1)?.quote?.price, 123.45);
    const count = snapshots.length;
    fake.book(asset.symbol === 'BTC' ? 'SOL' : 'BTC', 67000);
    fake.context(asset.symbol === 'BTC' ? 'SOL' : 'BTC');
    assert.equal(snapshots.length, count);
    fake.context(asset.symbol);
    assert.equal(snapshots.at(-1)?.previousDay, 100);
    stop();
    assert.ok(fake.signal?.aborted);
  }
});

test('disposing one edition aborts history and prevents late data from contaminating its replacement', async (t) => {
  const restore = browserGlobals();
  const stops: (() => void)[] = [];
  t.after(() => { stops.forEach((stop) => stop()); restore(); });
  const old = fixture();
  const next = fixture();
  const oldSnapshots: MarketSnapshot[] = [];
  const nextSnapshots: MarketSnapshot[] = [];
  const stopOld = startMarketFeed((snapshot) => oldSnapshots.push(snapshot), getAsset('BTC'), old.services);
  stops.push(stopOld);
  old.connected();
  old.book('BTC', 67000);
  stopOld();
  const oldCount = oldSnapshots.length;
  const stopNext = startMarketFeed((snapshot) => nextSnapshots.push(snapshot), getAsset('HYPE'), next.services);
  stops.push(stopNext);
  next.connected();
  assert.equal(nextSnapshots.at(-1)?.quote, null);
  assert.deepEqual(nextSnapshots.at(-1)?.points, []);
  old.book('BTC', 68000, Date.now() + 1);
  old.context('BTC');
  const now = Date.now();
  old.history([{ t: now - 120000, T: now - 60001, s: 'BTC', i: '1m', o: '67000', h: '67001', l: '66999', c: '67000', v: '1', n: 1 }]);
  await Promise.resolve();
  assert.equal(oldSnapshots.length, oldCount);
  assert.ok(old.signal?.aborted);
  assert.equal(old.closes, 1);
  assert.equal(nextSnapshots.at(-1)?.quote, null);
  next.book('HYPE', 38.42);
  assert.equal(nextSnapshots.at(-1)?.quote?.price, 38.42);
  stopNext();
  const nextCount = nextSnapshots.length;
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  next.context('HYPE');
  assert.equal(nextSnapshots.length, nextCount);
});
