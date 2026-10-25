import { expect, test, type Page } from '@playwright/test';

async function mockMarket(page: Page, options: { stale?: boolean; historyFails?: boolean; symbol?: string; price?: number } = {}) {
  const symbol = options.symbol ?? 'BTC';
  const price = options.price ?? 67001.5;
  const subscriptions: { type: string; coin?: string }[] = [];
  const historySymbols: string[] = [];
  const sockets: { send: (message: string) => void }[] = [];
  const sendBook = (price: number, time = Date.now(), coin = symbol) => {
    for (const socket of sockets) socket.send(JSON.stringify({ channel: 'l2Book', data: {
      coin, time, levels: [[{ px: String(price - 0.5), sz: '1', n: 1 }], [{ px: String(price + 0.5), sz: '1', n: 1 }]],
    } }));
  };
  await page.route('https://api.hyperliquid.xyz/info', async (route) => {
    const request = route.request().postDataJSON();
    if (request.type === 'candleSnapshot') historySymbols.push(request.req.coin);
    if (options.historyFails) { await route.fulfill({ status: 503, body: 'Unavailable' }); return; }
    const now = Date.now();
    await route.fulfill({ json: Array.from({ length: 60 }, (_, i) => ({
      s: symbol, i: '1m', t: now - (61 - i) * 60_000, T: now - (60 - i) * 60_000 - 1,
      o: String(price), h: String(price * 1.002), l: String(price * 0.998), c: String(price * (0.9985 + i * 0.00003 + Math.sin(i * 1.7) * 0.0004)), v: '10', n: 10,
    })) });
  });
  await page.routeWebSocket('wss://api.hyperliquid.xyz/ws', (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === 'ping') { socket.send(JSON.stringify({ channel: 'pong' })); return; }
      if (message.method !== 'subscribe') return;
      subscriptions.push(message.subscription);
      socket.send(JSON.stringify({ channel: 'subscriptionResponse', data: message }));
      if (message.subscription.type === 'l2Book') sendBook(price, Date.now() - (options.stale ? 60_000 : 0));
      if (message.subscription.type === 'activeAssetCtx') socket.send(JSON.stringify({ channel: 'activeAssetCtx', data: { coin: symbol, ctx: { prevDayPx: String(price * 0.97), dayNtlVlm: '1230000000', markPx: String(price), midPx: String(price) } } }));
    });
  });
  return { sendBook, subscriptions, historySymbols, close: () => {
    sockets.forEach((socket) => (socket as unknown as { close: () => void }).close());
    sockets.length = 0;
  } };
}

async function mockPlatform(page: Page, userAgent: string, platform: string, maxTouchPoints = 0) {
  await page.addInitScript(({ userAgent, platform, maxTouchPoints }) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => userAgent });
    Object.defineProperty(navigator, 'platform', { get: () => platform });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => maxTouchPoints });
  }, { userAgent, platform, maxTouchPoints });
}

async function openInstallDialog(page: Page) {
  await mockMarket(page);
  await page.goto('/');
  await page.mouse.move(40, 100);
  await page.getByRole('button', { name: /Install/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('SDK updates price and chart, QR points to BTC, and install controls work', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const feed = await mockMarket(page);
  await page.goto('/');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', '67001.50');
  await expect(page.getByRole('status')).toContainText('Live');
  await expect(page.getByRole('link', { name: 'Open Bitcoin on Bloxwap', exact: true })).toHaveAttribute('href', 'https://bloxwap.app/trade/BTC');
  await expect(page.locator('.qr-copy')).toContainText('The easiest way to trade.');
  await expect(page.locator('.current-marker')).toBeVisible();
  await expect(page.locator('.masthead')).toHaveCSS('opacity', '1');
  await expect(page.locator('.display-controls')).toHaveCSS('opacity', '0');
  expect(await page.getByTestId('price').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);
  feed.sendBook(67025.5, Date.now() + 1_000);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67025.50 US dollars');
  await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', '67025.50');
  // A delayed network frame cannot move the display backwards.
  feed.sendBook(1, Date.now() - 10_000);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67025.50 US dollars');
  await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', '67025.50');
  await page.mouse.move(40, 100);
  await page.getByRole('button', { name: '1H', exact: true }).click();
  await expect(page.getByRole('region', { name: /last 60 minutes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '1H', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const marker = await page.locator('.current-marker').boundingBox();
  const plot = await page.locator('.chart-plot').boundingBox();
  expect(marker!.x + marker!.width).toBeCloseTo(plot!.width - 8, 0);
  expect(marker!.y + marker!.height / 2).toBeCloseTo(plot!.height / 2, 0);
  await expect(page.locator('.asset-pill img')).toHaveAttribute('src', /brand\/BTC.svg$/);
  await expect(page.locator('.asset-symbol')).toHaveText('Bitcoin');
  await expect(page.locator('.asset-symbol')).toHaveCSS('border-right-width', '0px');
  expect(await page.locator('.asset-symbol').evaluate(el => getComputedStyle(el, '::after').content)).toContain('•');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByRole('region', { name: /live view/ })).toBeVisible();
  await page.getByRole('button', { name: /Install/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.install-options')).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}-install.png` });
  await page.getByRole('button', { name: 'Close installation instructions' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const viewport = page.viewportSize()!;
  const qr = await page.locator('.qr-link').boundingBox();
  const qrInset = await page.locator('.qr-block').evaluate(el => ({
    left: parseFloat(getComputedStyle(el).left), bottom: parseFloat(getComputedStyle(el).bottom),
  }));
  expect(qr!.x).toBeCloseTo(qrInset.left, 0);
  expect(qr!.y + qr!.height).toBeCloseTo(viewport.height - qrInset.bottom, 0);
  await expect(page.locator('.qr-code svg path').first()).toHaveAttribute('fill', '#0a0a0a');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    await Promise.allSettled((document.querySelector('number-flow-react')?.shadowRoot?.getAnimations() ?? []).map((animation) => animation.finished));
  });
  await page.screenshot({ path: `test-results/${info.project.name}-screensaver.png` });
  expect(errors).toEqual([]);
});

test('QR frame corners are concentric and the pattern stays unclipped at every layout', async ({ page }, info) => {
  await mockMarket(page);
  await page.goto('/');
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1920, height: 1080 },
    { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.locator('.qr-link').evaluate((card) => {
      const frame = card.querySelector('.qr-code')!;
      const svg = frame.querySelector('svg')!;
      const foreground = svg.querySelectorAll('path')[1];
      const outer = card.getBoundingClientRect(), inner = frame.getBoundingClientRect();
      const outerRadius = parseFloat(getComputedStyle(card).borderTopLeftRadius);
      const innerRadius = parseFloat(getComputedStyle(frame).borderTopLeftRadius);
      const bounds = foreground.getBBox();
      const moduleSize = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const margin = Math.min(bounds.x, bounds.y, svg.viewBox.baseVal.width - bounds.x - bounds.width, svg.viewBox.baseVal.height - bounds.y - bounds.height);
      // Rounded clipping must stay outside the QR's corner finder patterns.
      const clipRadius = innerRadius - parseFloat(getComputedStyle(frame).borderLeftWidth);
      const cornerDistance = Math.SQRT2 * Math.max(0, clipRadius - parseFloat(getComputedStyle(frame).paddingLeft) - margin * moduleSize);
      return {
        outerX: outer.x + outerRadius, innerX: inner.x + innerRadius,
        outerY: outer.y + outerRadius, innerY: inner.y + innerRadius,
        outerRightX: outer.right - outerRadius, innerRightX: inner.right - innerRadius,
        right: outer.right, bottom: outer.bottom, left: outer.left, top: outer.top,
        width: inner.width, height: inner.height, margin, cornerDistance, clipRadius,
      };
    });
    expect(geometry.outerX).toBeCloseTo(geometry.innerX, 1);
    expect(geometry.outerY).toBeCloseTo(geometry.innerY, 1);
    expect(geometry.outerRightX).toBeCloseTo(geometry.innerRightX, 1);
    expect(geometry.width).toBeCloseTo(geometry.height, 1);
    expect(geometry.margin).toBeGreaterThan(0);
    expect(geometry.cornerDistance).toBeLessThanOrEqual(geometry.clipRadius);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator('.qr-code svg path').first()).toHaveAttribute('fill', '#0a0a0a');
    await expect(page.locator('.qr-code svg path').nth(1)).toHaveAttribute('fill', '#ffffff');
    await page.locator('.qr-code').screenshot({ path: `test-results/${info.project.name}-qr-${viewport.width}.png`, scale: 'css' });
    await page.locator('.qr-link').screenshot({ path: `test-results/${info.project.name}-qr-card-${viewport.width}.png`, scale: 'css' });
  }
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`price jumps keep the trail attached to the pill with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.clock.install();
    const feed = await mockMarket(page);
    await page.route('https://api.hyperliquid.xyz/info', (route) => route.fulfill({ json: [] }));
    await page.addInitScript(() => {
      type Frame = { points: number[][]; pillX: number; pillY: number };
      const host = window as unknown as { __trailFrames: Frame[] };
      host.__trailFrames = [];
      const paths = new WeakMap<CanvasRenderingContext2D, number[][]>();
      const proto = CanvasRenderingContext2D.prototype;
      const { beginPath, moveTo, lineTo, bezierCurveTo, stroke } = proto;
      proto.beginPath = function () { paths.set(this, []); beginPath.call(this); };
      proto.moveTo = function (x, y) { paths.get(this)?.push([x, y]); moveTo.call(this, x, y); };
      proto.lineTo = function (x, y) { paths.get(this)?.push([x, y]); lineTo.call(this, x, y); };
      proto.bezierCurveTo = function (a, b, c, d, x, y) {
        paths.get(this)?.push([a, b], [c, d], [x, y]);
        bezierCurveTo.call(this, a, b, c, d, x, y);
      };
      proto.stroke = function (...args: [] | [Path2D]) {
        const pill = document.querySelector('.current-marker')?.getBoundingClientRect();
        const points = paths.get(this);
        if (pill && points?.length && this.strokeStyle instanceof CanvasGradient) {
          host.__trailFrames.push({ points: [...points], pillX: pill.left, pillY: pill.top + pill.height / 2 });
          if (host.__trailFrames.length > 100) host.__trailFrames.shift();
        }
        Reflect.apply(stroke, this, args);
      };
    });
    await page.goto('/');
    await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', '67001.50');
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await page.clock.runFor(400);
    await page.evaluate(() => { (window as unknown as { __trailFrames: unknown[] }).__trailFrames = []; });
    // The final update also adds a digit, changing the animated pill's width.
    for (const price of [67_101.5, 67_151.5, 100_001.5]) {
      feed.sendBook(price, await page.evaluate(() => Date.now()));
      await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', price.toFixed(2));
      await page.clock.runFor(80);
    }
    await page.clock.runFor(600);
    const frames = await page.evaluate(() => (window as unknown as {
      __trailFrames: { points: number[][]; pillX: number; pillY: number }[];
    }).__trailFrames);
    expect(frames.length).toBeGreaterThan(2);
    for (const frame of frames) {
      const tip = frame.points.at(-1)!;
      expect(tip[0]).toBeCloseTo(frame.pillX + 1, 0);
      expect(tip[1]).toBeCloseTo(frame.pillY, 0);
      // With rising prices, no past sample or curve control can leap above the live tip.
      // Raw quotes used to draw a spike here before the shared display tween caught up.
      expect(Math.min(...frame.points.map((point) => point[1]))).toBeGreaterThanOrEqual(frame.pillY - 0.01);
    }
  });
}

for (const { name, userAgent, platform, platformId } of [
  { name: 'macOS', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36', platform: 'MacIntel', platformId: 'macos' },
  { name: 'Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', platform: 'Win32', platformId: 'windows' },
  { name: 'Linux', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', platform: 'Linux x86_64', platformId: 'linux' },
]) {
  test(`${name} download opens the public website for the selected platform`, async ({ page }) => {
    await mockPlatform(page, userAgent, platform);
    await openInstallDialog(page);
    const download = page.getByRole('link', { name: `Download for ${name}`, exact: true });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('href', `https://bloxwap.github.io/screensaver/?platform=${platformId}#bitcoin`);
    await expect(download).toHaveAttribute('target', '_blank');
    await expect(page.locator('.install-primary')).toHaveCount(1);
    await expect(page.getByRole('dialog')).not.toContainText('GitHub sign-in');
    await expect(page.getByRole('dialog').locator('a[href*="/actions/"]')).toHaveCount(0);
    await expect(page.locator('.install-options')).toHaveCount(0);
  });
}

test('Android uses native app installation when available', async ({ page }) => {
  await mockPlatform(page, 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', 'Linux armv8l');
  await mockMarket(page);
  await page.goto('/');
  await page.evaluate(() => {
    const host = window as unknown as { __installPromptCount: number };
    host.__installPromptCount = 0;
    const event = new Event('beforeinstallprompt');
    Object.assign(event, {
      prompt: async () => { host.__installPromptCount += 1; },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });
  await page.mouse.move(40, 100);
  await page.getByRole('button', { name: /Install/ }).click();
  await page.getByRole('button', { name: 'Install for Android', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __installPromptCount: number }).__installPromptCount)).toBe(1);
});

test('iPadOS uses the native share sheet for home-screen installation', async ({ page }) => {
  await mockPlatform(page, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'MacIntel', 5);
  await page.addInitScript(() => {
    const host = window as unknown as { __shareData: ShareData | null };
    host.__shareData = null;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { host.__shareData = data; } });
  });
  await openInstallDialog(page);
  await page.getByRole('button', { name: 'Add to Home Screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shareData: ShareData | null }).__shareData?.title)).toBe('Bitcoin · Bloxwap Screensaver');
  expect(await page.evaluate(() => (window as unknown as { __shareData: ShareData | null }).__shareData?.url)).toBe(page.url());
});

test('desktop app settings replace the download action', async ({ page }) => {
  await page.addInitScript(() => {
    const settings = { idleEnabled: false, idleMinutes: 5 };
    Object.defineProperty(window, 'screensaver', { value: {
      dismiss: () => {},
      getSettings: async () => ({ ...settings }),
      setSettings: async (next: typeof settings) => { Object.assign(settings, next); return { ...settings }; },
    } });
  });
  await mockMarket(page);
  await page.goto('/');
  await page.mouse.move(40, 100);
  await page.getByRole('button', { name: /Settings/ }).click();
  const idle = page.getByLabel('Start when my computer is idle');
  await expect(idle).toBeVisible();
  await expect(page.locator('.install-primary')).toHaveCount(0);
  await idle.check();
  await expect(idle).toBeChecked();
  await page.getByLabel('Wait before starting').selectOption('15');
  await expect(page.getByLabel('Wait before starting')).toHaveValue('15');
});

test('full-screen grid flows left and reduced motion disables it', async ({ page }, info) => {
  await mockMarket(page);
  await page.goto('/');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  const grid = page.locator('.grid-bg');
  const motion = await grid.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error('Grid animation is missing');
    animation.pause();
    const xAt = (time: number) => {
      animation.currentTime = time;
      return new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    };
    const bounds = element.getBoundingClientRect();
    return {
      start: xAt(0), middle: xAt(500), end: xAt(999),
      backgroundSize: getComputedStyle(element).backgroundSize,
      width: bounds.width, height: bounds.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
    };
  });
  expect(motion.start).toBeCloseTo(0, 1);
  expect(motion.middle).toBeCloseTo(-25, 1);
  expect(motion.end).toBeCloseTo(-50, 1);
  expect(motion.backgroundSize).toBe('50px 50px');
  expect(motion.width).toBeGreaterThanOrEqual(motion.viewportWidth);
  expect(motion.height).toBe(motion.viewportHeight);
  await expect(page.locator('.masthead')).toHaveCSS('opacity', '1');
  await expect(page.locator('.display-controls')).toHaveCSS('opacity', '0');
  await page.screenshot({ path: `test-results/${info.project.name}-idle.png` });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(grid).toHaveCSS('animation-name', 'none');
});

test('narrow screens keep the header, controls, and QR card in bounds', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockMarket(page);
  await page.goto('/');
  await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', '67001.50');
  const asset = await page.locator('.asset-pill').boundingBox();
  const status = await page.locator('.connection').boundingBox();
  expect(asset!.x).toBeGreaterThanOrEqual(0);
  expect(asset!.x + asset!.width).toBeLessThanOrEqual(status!.x);
  expect(status!.x + status!.width).toBeLessThanOrEqual(320);
  await page.mouse.move(160, 300);
  await expect(page.locator('.display-controls')).toHaveCSS('opacity', '1');
  const controls = await page.locator('.display-controls').boundingBox();
  const qr = await page.locator('.qr-link').boundingBox();
  expect(controls!.x).toBeGreaterThanOrEqual(0);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(320);
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(qr!.y);
  expect(qr!.x).toBeGreaterThanOrEqual(0);
  expect(qr!.x + qr!.width).toBeLessThanOrEqual(320);
  expect(qr!.y + qr!.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await page.context().setOffline(true);
  feed.close();
  await expect(page.getByRole('status')).toContainText('Offline');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  await page.context().setOffline(false);
  await expect(page.locator('.screensaver.is-live')).toBeVisible({ timeout: 20_000 });
  feed.sendBook(67012.5, Date.now() + 1_000);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67012.50 US dollars');
});

for (const asset of [
  { symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin', price: 67001.5 },
  { symbol: 'SOL', name: 'Solana', slug: 'solana', price: 154.25 },
  { symbol: 'ETH', name: 'Ethereum', slug: 'ethereum', price: 3412.75 },
  { symbol: 'HYPE', name: 'Hyperliquid', slug: 'hyperliquid', price: 38.45 },
]) {
  test(`${asset.symbol} preview subscribes to its market and retains its identity on reload`, async ({ page }) => {
    const feed = await mockMarket(page, { symbol: asset.symbol, price: asset.price });
    await page.goto(`/?asset=${asset.symbol}`);
    await expect(page.getByTestId('price')).toHaveAttribute('aria-label', `${asset.name} ${asset.price.toFixed(2)} US dollars`);
    await expect(page.locator('.screensaver')).toHaveAttribute('data-asset', asset.symbol);
    await expect(page).toHaveTitle(`Bloxwap Screensaver · ${asset.name}`);
    await expect(page.locator('.asset-symbol')).toHaveText(asset.name);
    await expect(page.locator('.asset-pill img')).toHaveAttribute('src', new RegExp(`brand/${asset.symbol}\\.svg$`));
    await expect(page.getByRole('link', { name: `Open ${asset.name} on Bloxwap`, exact: true })).toHaveAttribute('href', `https://bloxwap.app/trade/${asset.symbol}`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', new RegExp(`manifest-${asset.symbol.toLowerCase()}\\.webmanifest$`));
    await expect.poll(() => feed.subscriptions.filter((entry) => entry.type === 'l2Book').length).toBe(1);
    expect(feed.subscriptions.map((entry) => entry.coin)).toEqual([asset.symbol, asset.symbol]);
    await expect.poll(() => feed.historySymbols.length).toBeGreaterThan(0);
    expect(new Set(feed.historySymbols)).toEqual(new Set([asset.symbol]));

    // A frame for another market must not change this edition's price or identity.
    feed.sendBook(99999.5, Date.now() + 1_000, asset.symbol === 'BTC' ? 'ETH' : 'BTC');
    feed.sendBook(asset.price + 1, Date.now() + 2_000);
    await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', (asset.price + 1).toFixed(2));
    await expect(page.locator('.asset-symbol')).toHaveText(asset.name);

    await page.reload();
    await expect(page.getByTestId('price')).toHaveAttribute('aria-label', `${asset.name} ${asset.price.toFixed(2)} US dollars`);
    await expect(page).toHaveURL(new RegExp(`asset=${asset.symbol}$`));
    await expect(page.getByRole('link', { name: 'Back to screensaver downloads' })).toBeVisible();
  });
}

test('unknown asset input safely selects Bitcoin', async ({ page }) => {
  const feed = await mockMarket(page);
  await page.goto('/?asset=../../unlisted');
  await expect(page.locator('.screensaver')).toHaveAttribute('data-asset', 'BTC');
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Bitcoin 67001.50 US dollars');
  expect(feed.subscriptions.every((entry) => entry.coin === 'BTC')).toBe(true);
  await expect(page.getByRole('link', { name: 'Open Bitcoin on Bloxwap', exact: true })).toHaveAttribute('href', 'https://bloxwap.app/trade/BTC');
});

test('changing asset through browser navigation resets the previous display', async ({ page }) => {
  await mockMarket(page, { symbol: 'HYPE', price: 38.45 });
  await page.goto('/?asset=HYPE');
  await expect(page.getByTestId('header-price')).toHaveAttribute('data-price', '38.45');
  const next = await mockMarket(page, { symbol: 'SOL', price: 154.25 });
  await page.evaluate(() => {
    history.pushState(null, '', '?asset=SOL');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Solana 154.25 US dollars');
  await expect(page.locator('.asset-symbol')).toHaveText('Solana');
  await expect(page.locator('.qr-copy')).toContainText('Trade SOL');
  expect(next.subscriptions.every((entry) => entry.coin === 'SOL')).toBe(true);
});

test('browser previews ignore desktop idle mode and retain visible navigation', async ({ page }) => {
  await mockMarket(page, { symbol: 'HYPE', price: 38.45 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?asset=HYPE&mode=idle');
  await expect(page.locator('.screensaver')).not.toHaveClass(/automatic/);
  await expect(page.getByRole('link', { name: 'Back to screensaver downloads' })).toBeVisible();
  await page.mouse.move(120, 200);
  await expect(page.getByRole('navigation', { name: 'Screensaver controls' })).toHaveCSS('opacity', '1');
  const asset = await page.locator('.asset-pill').boundingBox();
  const status = await page.locator('.connection').boundingBox();
  expect(asset!.x + asset!.width).toBeLessThanOrEqual(status!.x);
  expect(status!.x + status!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('page restoration restarts exactly one selected-asset subscription', async ({ page }) => {
  const feed = await mockMarket(page, { symbol: 'SOL', price: 154.25 });
  await page.goto('/?asset=SOL');
  await expect(page.getByRole('status')).toContainText('Live');
  await expect.poll(() => feed.subscriptions.filter((entry) => entry.type === 'l2Book').length).toBe(1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => feed.subscriptions.filter((entry) => entry.type === 'l2Book').length).toBe(2);
  expect(feed.subscriptions.every((entry) => entry.coin === 'SOL')).toBe(true);
  await expect(page.getByTestId('price')).toHaveAttribute('aria-label', 'Solana 154.25 US dollars');
});

test('Solana installation links back to the Solana download row', async ({ page }) => {
  await mockPlatform(page, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel');
  await mockMarket(page, { symbol: 'SOL', price: 154.25 });
  await page.goto('/?asset=SOL');
  await page.mouse.move(40, 100);
  await page.getByRole('button', { name: /Install/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep Solana in view.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download for macOS', exact: true })).toHaveAttribute('href', 'https://bloxwap.github.io/screensaver/?platform=macos#solana');
});

test('wake lock remains opt-in and recovers when visibility changes during a pending release', async ({ page }) => {
  type WakeState = {
    requests: number; firstReleases: number; secondReleases: number; hidden: boolean;
    resolveRequest: () => void; finishRelease: () => void;
  };
  await page.addInitScript(() => {
    const state = { requests: 0, firstReleases: 0, secondReleases: 0, hidden: false,
      resolveRequest: () => {}, finishRelease: () => {} };
    (window as unknown as { __wake: typeof state }).__wake = state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: () => {
        state.requests += 1;
        if (state.requests === 1) return new Promise((resolve) => {
          state.resolveRequest = () => resolve({ released: false, release: () => {
            state.firstReleases += 1;
            return new Promise<void>((done) => { state.finishRelease = done; });
          } });
        });
        return Promise.resolve({ released: false, release: async () => { state.secondReleases += 1; } });
      },
    } });
  });
  await mockMarket(page);
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Live');
  expect(await page.evaluate(() => (window as unknown as { __wake: WakeState }).__wake.requests)).toBe(0);
  await page.mouse.move(120, 200);
  const awake = page.getByRole('button', { name: 'Keep screen awake' });
  await awake.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: WakeState }).__wake.requests)).toBe(1);
  await page.evaluate(() => {
    const state = (window as unknown as { __wake: WakeState }).__wake;
    state.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    state.resolveRequest();
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: WakeState }).__wake.firstReleases)).toBe(1);
  await page.evaluate(() => {
    const state = (window as unknown as { __wake: WakeState }).__wake;
    state.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    state.finishRelease();
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: WakeState }).__wake.requests)).toBe(2);
  await expect(awake).toHaveAttribute('aria-pressed', 'true');
  await awake.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: WakeState }).__wake.secondReleases)).toBe(1);
  await expect(awake).toHaveAttribute('aria-pressed', 'false');
});
