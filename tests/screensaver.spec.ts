import { expect, test, type Page } from '@playwright/test';

async function mockMarket(page: Page, options: { stale?: boolean; historyFails?: boolean } = {}) {
  const sockets: { send: (message: string) => void }[] = [];
  const sendBook = (price: number, time = Date.now()) => {
    for (const socket of sockets) socket.send(JSON.stringify({ channel: 'l2Book', data: {
      coin: 'BTC', time, levels: [[{ px: String(price - 0.5), sz: '1', n: 1 }], [{ px: String(price + 0.5), sz: '1', n: 1 }]],
    } }));
  };
  await page.route('https://api.hyperliquid.xyz/info', async (route) => {
    if (options.historyFails) { await route.fulfill({ status: 503, body: 'Unavailable' }); return; }
    const now = Date.now();
    await route.fulfill({ json: Array.from({ length: 60 }, (_, i) => ({
      s: 'BTC', i: '1m', t: now - (61 - i) * 60_000, T: now - (60 - i) * 60_000 - 1,
      o: '67000', h: '67100', l: '66900', c: String(66900 + i * 2 + Math.sin(i * 1.7) * 30), v: '10', n: 10,
    })) });
  });
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === 'ping') { socket.send(JSON.stringify({ channel: 'pong' })); return; }
      if (message.method !== 'subscribe') return;
      socket.send(JSON.stringify({ channel: 'subscriptionResponse', data: message }));
      if (message.subscription.type === 'l2Book') sendBook(67001.5, Date.now() - (options.stale ? 60_000 : 0));
      if (message.subscription.type === 'activeAssetCtx') socket.send(JSON.stringify({ channel: 'activeAssetCtx', data: { coin: 'BTC', ctx: { prevDayPx: '65000', dayNtlVlm: '1230000000', markPx: '67001.5', midPx: '67001.5' } } }));
    });
  });
  return { sendBook, close: () => {
    sockets.forEach((socket) => (socket as unknown as { close: () => void }).close());
    sockets.length = 0;
  } };
}

test('SDK updates price and chart, QR points to BTC, and install controls work', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const feed = await mockMarket(page);
  await page.goto('/');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await expect(page.getByRole('status')).toContainText('Live');
  await expect(page.getByRole('link', { name: 'Open Bitcoin on Bloxwap', exact: true })).toHaveAttribute('href', 'https://bloxwap.app/trade/BTC');
  await expect(page.locator('.current-marker')).toBeVisible();
  feed.sendBook(67025.5, Date.now() + 1_000);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67025.50 US dollars');
  // A delayed network frame cannot move the display backwards.
  feed.sendBook(1, Date.now() - 10_000);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67025.50 US dollars');
  await page.getByRole('button', { name: '1H', exact: true }).click();
  await expect(page.getByRole('region', { name: /last 60 minutes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '1H', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const marker = await page.locator('.current-marker').boundingBox();
  const plot = await page.locator('.chart-plot').boundingBox();
  expect(marker!.x + marker!.width).toBeCloseTo(plot!.width - 8, 0);
  expect(marker!.y + marker!.height / 2).toBeCloseTo(plot!.height / 2, 0);
  await expect(page.locator('.price-pill img')).toHaveAttribute('src', /brand\/BTC.svg$/);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByRole('region', { name: /live view/ })).toBeVisible();
  await page.getByRole('button', { name: /Install/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close installation instructions' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const viewport = page.viewportSize()!;
  const qr = await page.locator('.qr-link').boundingBox();
  expect(qr!.x + qr!.width).toBeLessThanOrEqual(viewport.width);
  expect(qr!.y + qr!.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    await Promise.allSettled((document.querySelector('number-flow-react')?.shadowRoot?.getAnimations() ?? []).map((animation) => animation.finished));
  });
  await page.screenshot({ path: `test-results/${info.project.name}-screensaver.png` });
  expect(errors).toEqual([]);
});

test('server-delayed prices are never labeled live', async ({ page }) => {
  await mockMarket(page, { stale: true });
  await page.goto('/');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await expect(page.getByRole('status')).toContainText('Price delayed');
  await expect(page.locator('.stale-label')).toContainText('Last update');
});

test('history failure does not prevent fresh streaming prices', async ({ page }) => {
  await mockMarket(page, { historyFails: true });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Live');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await expect(page.locator('.history-note')).toBeVisible({ timeout: 20_000 });
});

test('disconnect preserves the last price; reconnect restores streaming', async ({ page }) => {
  const feed = await mockMarket(page);
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Live');
  await page.context().setOffline(true);
  feed.close();
  await expect(page.getByRole('status')).toContainText('Offline');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await page.context().setOffline(false);
  await expect(page.locator('.screensaver.is-live')).toBeVisible({ timeout: 20_000 });
  feed.sendBook(67012.5, Date.now() + 1_000);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67012.50 US dollars');
});
