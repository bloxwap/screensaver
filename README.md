# Screensaver

Bitcoin, in motion. A full-screen price display built with [Bloxwap Chart](https://github.com/bloxwap/chart), the [Bloxwap Hyperliquid SDK](https://github.com/bloxwap/hyperliquid), and [Bloxwap fonts](https://github.com/bloxwap/font).

A large green price readout rolls like an altimeter, with a full-screen chart centered on the current price and a bottom-right QR code that opens [Bitcoin on Bloxwap](https://bloxwap.app/trade/BTC). Starts with BTC/USD on Hyperliquid's Bitcoin perpetual market.

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4173. Move the pointer or tap to reveal Live / 5M / 15M / 1H, installation, keep-awake, and full-screen controls. The app opens with only the chart, large price, subtle watermark, and QR code visible. Asset identification and controls appear on interaction, then fade after four seconds; keyboard focus keeps controls visible. Delayed/offline status remains visible. The QR code stays in the bottom-right corner.

```sh
npm run build       # Type check + static PWA in dist/
npm run preview     # Preview the production build on port 4173
npm test            # Price validation, history merge, freshness, and desktop idle policy
npm run test:browser # Chromium + mobile WebKit integration checks (build first)
```

Install test browsers once with `npx playwright install chromium webkit`.

## Installation

| Platform | Installation and behavior |
| --- | --- |
| macOS, Windows, Linux | Installable desktop app with optional automatic idle activation, system tray controls, and all connected displays. Browser installation is also supported where available. |
| iPhone / iPad | Open an HTTPS deployment in Safari → Share → Add to Home Screen → Open as Web App. Launch manually. |
| Android | Open an HTTPS deployment in Chrome → Install app / Add to Home screen. Launch manually. |
| Other devices | Use a modern browser with Canvas, WebSocket, and WebAssembly or the chart's JavaScript fallback. Browser and installation support vary. |

The mobile version is a home-screen app, not a replacement for the operating system's lock-screen or screensaver. Full screen and Screen Wake Lock are feature-detected. Wake lock is opt-in, only active while visible, and may be refused by the browser or power settings. Mobile has no automatic idle activation. Desktop idle support depends on the OS; Linux Wayland compositors may not expose system idle state.

The app shell works offline after an initial online load. Market prices are never cached or fabricated: an existing session keeps its last observed price with an offline/stale indicator; a cold offline launch has no price until it reconnects.

### Desktop

```sh
npm run desktop       # Build and open Electron locally
npm run desktop:pack  # Build an unpacked application for this OS
npm run desktop:dist  # Build this OS's installer(s) in release/
```

Open **Settings** in the desktop app to enable automatic idle activation and choose 1–30 minutes. It starts disabled. Close the window to leave the enabled app in the system tray; use the tray menu to preview, reopen, or quit. Move the pointer or press a key to dismiss the automatic display. Automatic activation does not change sleep settings, prevent locking, or replace the secure lock screen. The app must be running; startup at login is not enabled automatically.

The **Desktop installers** GitHub Actions workflow builds macOS DMG/ZIP, Windows NSIS, and Linux AppImage/DEB artifacts on their respective operating systems. It is manually triggered and does not publish releases. Builds are unsigned unless signing is configured. Public distribution on macOS/Windows still needs appropriate signing/notarization; the local macOS build does not validate the Windows or Linux installers.

### Web hosting

Serve `dist/` from any HTTPS static host. The relative Vite base, manifest, and service-worker scope support subdirectory hosting such as `/screensaver/`. No backend, API key, wallet, or server secrets are required. The repo does not deploy itself. Serve `index.html`, `sw.js`, and `manifest.webmanifest` with revalidation; hashed assets can be cached immutably.

## Data and display

- `@bloxwap/hyperliquid` opens one mainnet WebSocket per display. A fast `l2Book` subscription supplies the unrounded `(best bid + best ask) / 2`, matching Bloxwap's midpoint convention. `activeAssetCtx` supplies the previous-day price and 24-hour USD volume.
- HTTP `candleSnapshot` seeds one hour of actual **closed one-minute trade candles**. The trail initially contains those closes, then records observed live midpoints. History and midpoint ticks are related price series, not identical measurements. Only live book updates drive the price pills and freshness indicator.
- Charts use `@bloxwap/chart` with a custom series renderer using the monorepo’s shared monotone spline and altimeter math. The default Live view uses the trading app’s 50px/second flow and 44px price-tick spacing, scaled together by 1.5× on large displays. Optional 5-minute, 15-minute, and 1-hour views fit the selected history. No random prices or synthetic historical candles are generated. A line between observations is visual interpolation, not an assertion of trades during the gap.
- Bid/ask, timestamps, and frame ordering are validated. An open connection is insufficient for “LIVE”: the displayed quote must have arrived after the current connection opened and have a server timestamp less than 15 seconds old. Device clocks should be synchronized.
- The SDK reconnects and resubscribes. The app refreshes history after reconnect, retries failed subscriptions and history, and rebuilds a silent connection after 30 seconds. Late history cannot overwrite newer live samples.
- Storage is bounded to an hour and 3,700 points. Display work pauses while hidden. Canvas resolution is capped at 2× and continuous flow at 30fps; reduced-motion settings use static readouts and update the chart on observations/clock ticks without continuous motion.

## Bloxwap design sources

The display follows [Bloxwap’s Bitcoin trading screen](https://bloxwap.app/trade/BTC), [brand guide](https://bloxwap.com/docs/brand), and [HIG](https://bloxwap.github.io/hig/). The supplied `/tradeBTCa/BTC` URL returned 404; `/trade/BTC` is the canonical route.

`src/bloxwap/` and `public/brand/` contain an explicit snapshot from `../monorepo`: the drawn wordmark and icon geometry, Bitcoin SVG, color tokens, Bloxwap Sans/Mono, Space Grotesk Bold, and shared chart geometry/easing. The grid and layout follow the app’s trading screen. `src/bloxwap/provenance.json` records source paths, commit, font version, and hashes. Font licenses ship with the app. Public builds need no monorepo checkout.

To refresh from a sibling checkout with its font dependency installed:

```sh
npm run sync:bloxwap
```

The HIG informs readable numeric labels, persistent stale/offline states, a chart text summary, keyboard focus, visible dialog dismissal, touch targets, and reduced motion. The candidate HIG chart wrapper targets an older chart SDK, so this app uses the current chart SDK directly.

## Layout

```text
src/market/        SDK integration, validation, bounded history, freshness
src/components/    Bloxwap chart and installation/preferences dialog
src/App.tsx        Price readout, QR code, status, and display controls
desktop/           Sandboxed Electron host, tray, and idle activation
tests/             Browser integration tests using the real SDK with mocked transport
```

React/Vite builds a single renderer used by the PWA and desktop host. The desktop renderer is sandboxed, with Node integration disabled and a narrow settings/dismiss bridge. Desktop packaging stages only bundled assets, not the full SDK/font source packages.

Browser installation details follow [MDN's PWA guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable); desktop idle detection uses [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor).
