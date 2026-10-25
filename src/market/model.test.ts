import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POINTS, STALE_MS, bookQuote, candlePoints, feedStatus, initialSnapshot, mergePoints, toPoint } from './model';
import { ASSETS, DEFAULT_ASSET, getAsset } from '../assets';

const now = 1_800_000_000_000;
const book = { coin: 'BTC', time: now, levels: [[{ px: '67000' }], [{ px: '67001' }]] as [{ px: string }[], { px: string }[]] };

test('catalog resolves only supported identities and cannot be changed by a consumer', () => {
  assert.deepEqual(ASSETS.map(({ symbol }) => symbol), ['BTC', 'SOL', 'ETH', 'HYPE']);
  for (const asset of ASSETS) {
    assert.equal(getAsset(` ${asset.symbol.toLowerCase()} `), asset);
    assert.equal(asset.tradeUrl, `https://bloxwap.app/trade/${asset.symbol}`);
    assert.equal(asset.icon, `brand/${asset.symbol}.svg`);
    assert.ok(Object.isFrozen(asset));
  }
  for (const input of [null, undefined, '', 'DOGE', '../../ETH', 'BTC&asset=SOL']) assert.equal(getAsset(input), DEFAULT_ASSET);
  assert.ok(Object.isFrozen(ASSETS));
});

test('all editions accept only their own market data without rounding low-priced quotes', () => {
  const prices = [67000, 150, 3500, 0.1234];
  for (const [index, asset] of ASSETS.entries()) {
    const bid = prices[index];
    const ask = bid + 0.0002;
    const frame = { ...book, coin: asset.symbol, levels: [[{ px: String(bid) }], [{ px: String(ask) }]] as typeof book.levels };
    assert.equal(bookQuote(frame, now, null, asset.symbol)?.price, (bid + ask) / 2);
    for (const other of ASSETS.filter(({ symbol }) => symbol !== asset.symbol)) {
      assert.equal(bookQuote({ ...frame, coin: other.symbol }, now, null, asset.symbol), null);
    }
    const history = ASSETS.map(({ symbol }, i) => ({ t: now - 120_000, T: now - 60_001, c: String(prices[i]), s: symbol }));
    assert.deepEqual(candlePoints(history, now, asset.symbol).map(({ close }) => close), [bid]);
  }
});

test('price is the unrounded midpoint; invalid, crossed, stale-order and future frames are rejected', () => {
  const quote = bookQuote(book, now, null)!;
  assert.equal(quote.price, 67000.5);
  assert.equal(bookQuote({ ...book, time: now - 1 }, now, quote), null);
  assert.equal(bookQuote(book, now, quote), null);
  assert.equal(bookQuote({ ...book, time: now + 60_000 }, now, null), null);
  assert.equal(bookQuote({ ...book, coin: 'ETH' }, now, null), null);
  for (const levels of [[[], []], [[{ px: 'NaN' }], [{ px: '2' }]], [[{ px: '3' }], [{ px: '2' }]], [[{ px: '0' }], [{ px: '2' }]]]) {
    assert.equal(bookQuote({ ...book, levels: levels as typeof book.levels }, now, null), null);
  }
});

test('slow history cannot roll back a live point, even when timestamps coincide', () => {
  const live = toPoint(now - 1_000, 67002, 'live');
  const history = toPoint(now - 1_000, 66900, 'history');
  assert.equal(mergePoints([history], [live], now)[0].close, 67002);
  assert.equal(mergePoints([live], [history], now)[0].close, 67002);
});

test('history uses closed candle timestamps in seconds and excludes future/unfinished candles', () => {
  const points = candlePoints([
    { t: now - 120_000, T: now - 60_001, c: '67000', s: 'BTC' },
    { t: now, T: now + 59_999, c: '67002', s: 'BTC' },
    { t: NaN, T: now - 1, c: '67002', s: 'BTC' },
    { t: now - 60_000, T: NaN, c: '67002', s: 'BTC' },
  ], now);
  assert.equal(points.length, 1);
  assert.equal(points[0].time, Math.floor((now - 60_001) / 1_000));
});

test('long sessions stay sorted, one point per second, and bounded to an hour', () => {
  const points = Array.from({ length: 10_000 }, (_, i) => toPoint(now - i * 500, 67_000 + i, 'live'));
  const merged = mergePoints([], points, now);
  assert.ok(merged.length <= MAX_POINTS);
  assert.equal(new Set(merged.map((p) => p.time)).size, merged.length);
  assert.ok(merged.every((p, i) => i === 0 || p.time > merged[i - 1].time));
  assert.ok(merged[0].time >= (now - 3_600_000) / 1_000);
});

test('an open socket alone never means live; stale server data and pre-reconnect quotes are marked stale', () => {
  const state = { ...initialSnapshot(), connection: 'connected' as const, connectedAt: now - 100 };
  assert.equal(feedStatus(state, now, true), 'connecting');
  state.quote = { price: 67_000, time: now, receivedAt: now };
  assert.equal(feedStatus(state, now, true), 'live');
  assert.equal(feedStatus(state, now + STALE_MS + 1, true), 'stale');
  assert.equal(feedStatus(state, now, false), 'offline');
  state.quote = { price: 67_000, time: now - STALE_MS - 1, receivedAt: now };
  assert.equal(feedStatus(state, now, true), 'stale');
  state.quote = { price: 67_000, time: now - 200, receivedAt: now - 200 };
  assert.equal(feedStatus(state, now, true), 'stale');
});
