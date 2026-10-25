import { expect, test, type Page } from '@playwright/test';

const assets = [
  { symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin', price: 67001.5 },
  { symbol: 'SOL', name: 'Solana', slug: 'solana', price: 154.25 },
  { symbol: 'ETH', name: 'Ethereum', slug: 'ethereum', price: 3412.75 },
  { symbol: 'HYPE', name: 'Hyperliquid', slug: 'hyperliquid', price: 38.45 },
] as const;

type Download = { asset: string; platform: string; arch: string; format: string; filename: string; url: string; size: number; sha256: string; signed: boolean };
type Manifest = { schemaVersion: number; version: string | null; channel: string; downloads: Download[] };

async function mockPreview(page: Page, symbol: string, price: number) {
  const subscriptions: string[] = [];
  await page.route('https://api.hyperliquid.xyz/info', (route) => route.fulfill({ json: [] }));
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === 'ping') { socket.send(JSON.stringify({ channel: 'pong' })); return; }
      if (message.method !== 'subscribe') return;
      subscriptions.push(message.subscription.coin);
      socket.send(JSON.stringify({ channel: 'subscriptionResponse', data: message }));
      if (message.subscription.type === 'l2Book') socket.send(JSON.stringify({ channel: 'l2Book', data: {
        coin: symbol, time: Date.now(), levels: [[{ px: String(price - 0.01), sz: '1', n: 1 }], [{ px: String(price + 0.01), sz: '1', n: 1 }]],
      } }));
      if (message.subscription.type === 'activeAssetCtx') socket.send(JSON.stringify({ channel: 'activeAssetCtx', data: {
        coin: symbol, ctx: { prevDayPx: String(price * 0.97), dayNtlVlm: '10000000', markPx: String(price), midPx: String(price) },
      } }));
    });
  });
  return subscriptions;
}

test('homepage presents four assets and three operating systems without starting market streams', async ({ page, baseURL }, info) => {
  const marketRequests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('api.hyperliquid.xyz')) marketRequests.push(request.url()); });
  page.on('websocket', (socket) => marketRequests.push(socket.url()));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  const table = page.getByRole('table', { name: 'Screensaver downloads by asset and operating system' });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  for (const os of ['Mac', 'Windows', 'Linux']) await expect(table.getByRole('columnheader', { name: os, exact: true })).toHaveCount(1);
  expect(await table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-asset')))).toEqual(assets.map((asset) => asset.symbol));
  for (const asset of assets) {
    const row = table.locator(`tr[data-asset="${asset.symbol}"]`);
    await expect(row.getByRole('rowheader')).toContainText(asset.name);
    await expect(row.getByRole('link', { name: `Preview ${asset.name} screensaver` })).toHaveAttribute('href', new URL(`preview/?asset=${asset.symbol}`, baseURL).pathname + `?asset=${asset.symbol}`);
    for (const os of ['Mac', 'Windows', 'Linux']) await expect(row.locator(`td[data-label="${os}"]`)).toBeVisible();
    expect(await row.locator('img').evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  expect(marketRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('landing.png'), fullPage: true });
});

test('every installer link matches the published manifest and absent releases have no placeholder downloads', async ({ page, request }) => {
  const response = await request.get('releases.json');
  expect(response.status()).toBe(200);
  const manifest = await response.json() as Manifest;
  expect(manifest.schemaVersion).toBe(1);
  await page.goto('./');
  const links = page.locator('a[href*="/bloxwap/screensaver/releases/download/"]');
  await expect(links).toHaveCount(manifest.downloads.length);
  const actual = await links.evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href).sort());
  expect(actual).toEqual(manifest.downloads.map((download) => download.url).sort());
  if (!manifest.downloads.length) {
    await expect(page.locator('.download-unavailable')).toHaveCount(12);
    await expect(page.locator('.release-notice')).toContainText('Desktop builds are on the way');
    return;
  }
  expect(manifest.version).toBeTruthy();
  const columns: Record<string, string> = { macos: 'Mac', windows: 'Windows', linux: 'Linux' };
  for (const download of manifest.downloads) {
    expect(download.size).toBeGreaterThan(0);
    expect(download.sha256).toMatch(/^[a-f\d]{64}$/i);
    expect(download.url).toMatch(/^https:\/\/github\.com\/bloxwap\/screensaver\/releases\/download\//);
    const cell = page.locator(`tr[data-asset="${download.asset}"] td[data-label="${columns[download.platform]}"]`);
    const link = cell.locator(`a[href=${JSON.stringify(download.url)}]`);
    await expect(link).toHaveCount(1);
    const accessibleName = await link.getAttribute('aria-label');
    expect(accessibleName).toContain(assets.find((asset) => asset.symbol === download.asset)!.name);
    expect(accessibleName).toContain(columns[download.platform]);
  }
  if (manifest.downloads.some((download) => download.platform !== 'linux' && !download.signed)) {
    await expect(page.locator('.release-notice')).toContainText('unsigned');
  }
});

test('download cards fit narrow screens and keep preview links keyboard accessible', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('./');
  for (const asset of assets) {
    const row = page.locator(`tr[data-asset="${asset.symbol}"]`);
    await row.scrollIntoViewIfNeeded();
    const bounds = await row.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    const preview = row.getByRole('link', { name: `Preview ${asset.name} screensaver` });
    await preview.focus();
    await expect(preview).toBeFocused();
    await expect(preview).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('landing-320.png'), fullPage: true });
});

for (const asset of assets) {
  test(`${asset.symbol} direct preview loads, reloads, and returns to downloads`, async ({ page, baseURL }) => {
    const subscriptions = await mockPreview(page, asset.symbol, asset.price);
    const response = await page.goto(`preview/?asset=${asset.symbol}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('price')).toHaveAttribute('aria-label', `${asset.name} ${asset.price.toFixed(2)} US dollars`);
    await expect(page.getByRole('link', { name: `Open ${asset.name} on Bloxwap`, exact: true })).toHaveAttribute('href', `https://bloxwap.app/trade/${asset.symbol}`);
    expect(subscriptions).toEqual([asset.symbol, asset.symbol]);
    await page.reload();
    await expect(page).toHaveTitle(`Bloxwap Screensaver · ${asset.name}`);
    await expect(page.getByTestId('price')).toHaveAttribute('aria-label', `${asset.name} ${asset.price.toFixed(2)} US dollars`);
    const back = page.getByRole('link', { name: 'Back to screensaver downloads' });
    await expect(back).toHaveAttribute('href', baseURL!);
    await back.click();
    await expect(page).toHaveURL(baseURL!);
    await expect(page.getByRole('table', { name: 'Screensaver downloads by asset and operating system' })).toBeVisible();
  });
}

test('installation docs support direct navigation and static search is available', async ({ page, request }) => {
  const response = await page.goto('docs/installation/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/install/i);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/install/i);
  const search = await request.get('search.json');
  expect(search.status()).toBe(200);
  expect((await search.text()).toLowerCase()).toContain('install');
});

test.describe('preview service-worker isolation', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the installed preview cannot control the homepage or documentation', async ({ page, baseURL, request }) => {
    await mockPreview(page, 'SOL', 154.25);
    for (const asset of assets) {
      const response = await request.get(`preview/manifest-${asset.symbol.toLowerCase()}.webmanifest`);
      expect(response.status()).toBe(200);
      const manifest = await response.json();
      expect(manifest.scope).toBe('./');
      expect(manifest.start_url).toBe(`./?asset=${asset.symbol}`);
      expect(manifest.name).toContain(asset.name);
    }
    await page.goto('preview/?asset=SOL');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(new URL('preview/', baseURL).href);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.goto('./');
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await page.goto('docs/');
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  });
});
