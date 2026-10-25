import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('installed shell loads offline without inventing a cached price', async ({ page, context, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Bloxwap Screensaver');
  expect(manifest.start_url).toBe('./');
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toContain('512x512');
  await page.route('https://api.hyperliquid.xyz/**', (route) => route.abort());
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => socket.close());
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Offline');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Waiting for Bitcoin price');
  await expect(page.getByRole('link', { name: 'Open Bitcoin on Bloxwap', exact: true })).toBeVisible();
});

test('installed Solana edition retains its asset on a cold offline reload', async ({ page, context, request }) => {
  const response = await request.get('/manifest-sol.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.name).toContain('Solana');
  expect(manifest.scope).toBe('./');
  expect(manifest.start_url).toBe('./?asset=SOL');
  await page.route('https://api.hyperliquid.xyz/**', (route) => route.abort());
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => socket.close());
  await page.goto('/?asset=SOL');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Offline');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Waiting for Solana price');
  await expect(page.locator('.screensaver')).toHaveAttribute('data-asset', 'SOL');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest-sol\.webmanifest$/);
  await expect(page.getByRole('link', { name: 'Open Solana on Bloxwap', exact: true })).toHaveAttribute('href', 'https://bloxwap.app/trade/SOL');
});

for (const isPreview of [false, true]) {
  test(`native host ${isPreview ? 'preview' : 'display'} never registers a service worker`, async ({ page }) => {
    await page.addInitScript((isPreview) => {
      Object.defineProperty(window, 'nativeScreensaver', { value: Object.freeze({ asset: 'SOL', isPreview }) });
    }, isPreview);
    await page.route('https://api.hyperliquid.xyz/**', (route) => route.abort());
    await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => socket.close());
    await page.goto('/?asset=BTC');
    await expect(page.locator('.screensaver')).toHaveAttribute('data-host', 'native');
    await expect(page.locator('.screensaver')).toHaveAttribute('data-asset', 'SOL');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await page.reload();
    await expect(page.locator('.screensaver')).toHaveAttribute('data-asset', 'SOL');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });
}

test('native-looking URL parameters retain browser PWA installation', async ({ page }) => {
  await page.route('https://api.hyperliquid.xyz/**', (route) => route.abort());
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => socket.close());
  await page.goto('/?asset=SOL&mode=native&nativeScreensaver=true&isPreview=true');
  await expect(page.locator('.screensaver')).toHaveAttribute('data-host', 'browser');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('./', page.url()).href);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest-sol\.webmanifest$/);
});
