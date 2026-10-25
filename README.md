# Bloxwap Screensaver

Bitcoin, Solana, Ethereum, and Hyperliquid, in motion. A full-screen live price display built with [Bloxwap Chart](https://github.com/bloxwap/chart), the [Bloxwap Hyperliquid SDK](https://github.com/bloxwap/hyperliquid), and [Bloxwap fonts](https://github.com/bloxwap/font).

**[Download or preview](https://bloxwap.github.io/screensaver/)** · [Documentation](https://bloxwap.github.io/screensaver/docs/) · [Releases](https://github.com/bloxwap/screensaver/releases)

| Edition | Market | Desktop downloads | Browser preview |
| --- | --- | --- | --- |
| Bitcoin | BTC | Mac · Windows · Linux | [Preview Bitcoin](https://bloxwap.github.io/screensaver/preview/?asset=BTC) |
| Solana | SOL | Mac · Windows · Linux | [Preview Solana](https://bloxwap.github.io/screensaver/preview/?asset=SOL) |
| Ethereum | ETH | Mac · Windows · Linux | [Preview Ethereum](https://bloxwap.github.io/screensaver/preview/?asset=ETH) |
| Hyperliquid | HYPE | Mac · Windows · Linux | [Preview Hyperliquid](https://bloxwap.github.io/screensaver/preview/?asset=HYPE) |

A large green price readout rolls like an altimeter above a full-screen price trail. The bottom-left trade QR opens the selected asset on Bloxwap. Each edition opens its own asset automatically. Mac `0.2.x` editions are native `.saver` bundles hosted by macOS; archived `0.1.x` Mac editions remain labeled as apps. Windows and Linux editions are desktop apps with independent preferences. One web renderer powers every edition and the live browser previews.

The QR uses white SVG modules on a near-black (`#0a0a0a`) background and Q-level error correction. Its compact layout uses a two-module SVG margin plus 4pt of wrapper padding, with the finder patterns kept clear of rounded clipping. This is tighter than [DENSO's standard four-module quiet zone](https://www.qrcode.com/en/howto/code.html); verify scanning on the intended display and camera. It renders at 410px on desktop and 492px on large displays, with smaller sizes fitted to mobile and landscape layouts. The card radius derives from the QR radius, padding, and border to keep the top corners concentric. Scanning range depends on the physical display, camera, lighting, and angle.

## Run

Requires Node.js 24 or newer. npm is the workspace's lockfile authority.

```sh
npm ci
npm run dev
```

After installing dependencies, Bun can invoke the same scripts with `bun run dev`.

The dev server opens http://127.0.0.1:5173 in your default browser. Choose an edition with `?asset=BTC`, `?asset=SOL`, `?asset=ETH`, or `?asset=HYPE`; for example, http://127.0.0.1:5173/?asset=SOL. The full-screen 50px plus grid flows right-to-left at 50px/second beneath persistent asset and Hyperliquid status pills, a subtle centered wordmark, and the QR card. In the browser and Windows/Linux main window, move the pointer or tap to reveal Live / 5M / 15M / 1H, installation, keep-awake, and full-screen controls; these fade after four seconds, while keyboard focus keeps them visible. macOS manages interaction and dismissal in its native screen saver host. Delayed/offline status and the last valid price remain visible. Reduced-motion preferences stop the grid and continuous chart motion.

```sh
npm run build       # Type check + static PWA in dist/
npm run preview     # Preview the production build on port 5173
npm test            # Market, display, desktop, and release-contract checks
npm run test:browser # Chromium + mobile WebKit integration checks (build first)
npm run docs:check   # Check the private docs workspace
npm run docs:build   # Build website, docs, and live previews
npm run test:site    # Browser checks against the built website
npm run docs:preview # Serve http://127.0.0.1:3907/screensaver/
```

Install test browsers once with `npx playwright install chromium webkit`.

## Installation

Choose an asset and operating system on the [download page](https://bloxwap.github.io/screensaver/). Files are hosted in public GitHub Releases and do not require GitHub sign-in. The page shows the available version, architecture, and signing status; unavailable builds stay disabled. **Install** in a browser preview opens the matching edition's downloads. Supported mobile browsers use their native install or share flow.

Mac builds target **macOS 13 or newer**, with separate Apple silicon (`arm64`) and Intel (`x64`) downloads. For files labeled **.saver**, install the enclosed bundle into `~/Library/Screen Savers` for your account or `/Library/Screen Savers` for all users, then select it in macOS Screen Saver settings. Archived downloads labeled **App** use the older Applications-folder installation. Windows provides an x64 app installer; Linux provides x64 AppImage/DEB apps. See [installation](https://bloxwap.github.io/screensaver/docs/installation/) and the [native host compatibility note](https://bloxwap.github.io/screensaver/docs/troubleshooting/#macos-host-compatibility) for the verified paths and current limits.

Preview releases are unsigned development builds and may receive operating-system prompts or blocks. Use a browser preview if you prefer to wait for a signed release. Stable Mac and Windows releases require configured signing and verification. See the [installation guide](https://bloxwap.github.io/screensaver/docs/installation/).

| Platform | Installation and behavior |
| --- | --- |
| macOS | Native `.saver` bundle selected in macOS Screen Saver settings. The OS controls idle timing, preview, dismissal, locking, and display placement. |
| Windows, Linux | Desktop app with optional automatic idle activation, system tray controls, and connected-display support. |
| iPhone / iPad | Open an HTTPS deployment in Safari → Share → Add to Home Screen → Open as Web App. Launch manually. |
| Android | Open an HTTPS deployment in Chrome → Install app / Add to Home screen. Launch manually. |
| Other devices | Use a modern browser with Canvas, WebSocket, and WebAssembly or the chart's JavaScript fallback. Browser and installation support vary. |

The mobile version is a home-screen app, not a replacement for the operating system's lock-screen or screensaver. Browser fullscreen and Screen Wake Lock are feature-detected. Wake lock is opt-in, only active while visible, and may be refused by the browser or power settings. Mobile has no automatic idle activation. Windows/Linux app idle support depends on the OS; Linux Wayland compositors may not expose system idle state.

The browser shell works offline after an initial online load; native downloads bundle the display resources locally. Market prices are never cached or fabricated: an existing session keeps its last observation with an offline/stale indicator; a cold offline launch has no price until it reconnects.

### Desktop

```sh
npm run desktop:pack -- --asset BTC
npm run desktop:dist -- --asset SOL --arch arm64
```

Build on the target operating system. Mac builds require the Xcode Command Line Tools and produce a Swift `ScreenSaverView` bundle embedding the shared renderer in `WKWebView`. The last command packages Solana's native `.saver` for Apple silicon in DMG and ZIP; use `--arch x64` for Intel Mac, Windows, or Linux. `desktop:pack` leaves the unpacked Mac bundle at `release/bitcoin-macos-arm64/Bloxwap Bitcoin Screensaver.saver` on an Apple silicon build. Outputs are isolated by edition, OS, and architecture under `release/`.

On **Mac**, install the `.saver`, select its edition in macOS Screen Saver settings, and use the OS preview and activation settings. macOS owns the timer, display placement, dismissal, sleep, and password/lock behavior; no Bloxwap tray process or login app is required.

On **Windows and Linux**, open the app's **Settings** to enable automatic idle activation and choose 1–30 minutes. It starts disabled. Closing the window leaves an enabled app in the system tray; its menu can preview, reopen, or quit it. The app must be running; startup at login is not enabled automatically. Sleep and secure-lock settings still apply. Windows uses a standalone app, without a native `.scr` module. `npm run desktop` opens the Electron development host for this app path.

The **Desktop installers** GitHub Actions workflow builds all four editions on their target operating systems. Relevant changes on `main` produce unsigned preview prereleases; stable version tags require signing verification. Complete releases include 28 installer/archive files, checksums, and a verified download manifest. The website refreshes from that manifest after publication. See [RELEASE.md](RELEASE.md), [signing setup](.github/SIGNING.md), and the [task backlog](.github/planning/TASKS.md) for release commands and verification gates.

### Web hosting

The private `apps/docs` workspace follows the other Bloxwap project sites. `npm run docs:build` combines its static export with the Vite renderer at `/screensaver/preview/`; `npm run docs:preview` serves the complete website locally at http://127.0.0.1:3907/screensaver/. `npm run docs:dev` runs both steps for a complete local site; rerun the build after source changes.

The **Documentation** workflow deploys the combined export to GitHub Pages at https://bloxwap.github.io/screensaver/. The preview's manifest and service-worker scope stay within `/screensaver/preview/`. No backend, API key, wallet, or runtime server secrets are required. The standalone renderer in `dist/` can also be served from an HTTPS static host.

## Data and display

- `@bloxwap/hyperliquid` opens one mainnet WebSocket per display. A fast `l2Book` subscription supplies the unrounded `(best bid + best ask) / 2`, matching Bloxwap's midpoint convention. `activeAssetCtx` supplies the previous-day price and 24-hour USD volume.
- HTTP `candleSnapshot` seeds one hour of actual **closed one-minute trade candles**. Stored history then records observed live midpoints. History and midpoint ticks are related price series, not identical measurements. Live book updates supply the quoted prices and freshness indicator.
- Charts use `@bloxwap/chart` with a custom series renderer using the monorepo’s shared monotone spline and altimeter math. The default Live view uses the trading app’s 50px/second flow and 44px price-tick spacing, scaled together by 1.5× on large displays. As in `apps/app/src/components/trading/live-chart.tsx`, one 300ms display-price tween drives the scale, trail tip, and pill position; the recent trail and pill readout sample that eased value every 200ms. Fast quotes retarget the tween without restarting its clock. Optional 5-minute, 15-minute, and 1-hour views combine this recent display trail with older observed history. Display samples never replace stored market observations. A line between observations is visual interpolation, not an assertion of trades during the gap.
- Bid/ask, timestamps, and frame ordering are validated. An open connection is insufficient for “LIVE”: the displayed quote must have arrived after the current connection opened and have a server timestamp less than 15 seconds old. Device clocks should be synchronized.
- The SDK reconnects and resubscribes. The app refreshes history after reconnect, retries failed subscriptions and history, and rebuilds a silent connection after 30 seconds. Late history cannot overwrite newer live samples.
- Stored market history is bounded to an hour and 3,700 points; eased display samples retain one minute. Display work pauses while hidden and snaps to the current quote on resume. Canvas resolution is capped at 2× and continuous flow at 30fps; reduced-motion settings snap to observed quotes without tweening or continuous motion.

## Bloxwap design sources

The display follows [Bloxwap’s Bitcoin trading screen](https://bloxwap.app/trade/BTC), [brand guide](https://bloxwap.com/docs/brand), and [HIG](https://bloxwap.github.io/hig/). The supplied `/tradeBTCa/BTC` URL returned 404; `/trade/BTC` is the canonical route.

`src/bloxwap/` and `public/brand/` contain an explicit snapshot from `../monorepo`: the drawn wordmark and icon geometry, asset SVGs, color tokens, Bloxwap Sans/Mono, Space Grotesk Bold, and shared chart geometry/easing. The grid and layout follow the app’s trading screen. `src/bloxwap/provenance.json` records source paths, commit, font version, and hashes. Font licenses ship with the app. Public builds need no monorepo checkout.

To refresh from a sibling checkout with its font dependency installed:

```sh
npm run sync:bloxwap
```

The HIG informs readable numeric labels, persistent stale/offline states, a chart text summary, keyboard focus, visible dialog dismissal, touch targets, and reduced motion. The candidate HIG chart wrapper targets an older chart SDK, so this app uses the current chart SDK directly.

## Layout

```text
config/            Shared asset catalog and verified release manifest
src/market/        SDK integration, validation, bounded history, freshness
src/components/    Bloxwap chart and installation/preferences dialog
src/App.tsx        Price readout, QR code, status, and display controls
native/macos/      Native ScreenSaverView and WKWebView host
desktop/           Windows/Linux Electron host, identity, tray, idle activation
apps/docs/         Private static landing page and documentation
scripts/           Packaging, release metadata, website build checks
tests/             Renderer and website browser integration checks
```

React/Vite builds a single renderer used by the PWA, the Mac native screen saver, and the Windows/Linux desktop host. The Mac host loads bundled resources in `WKWebView`. The Electron host is sandboxed, with Node integration disabled and a narrow settings/dismiss bridge. Packaging stages bundled assets without the full SDK/font source packages.

Browser installation follows [MDN's PWA guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). Mac integration uses [Apple's Screen Saver framework](https://developer.apple.com/documentation/screensaver); Windows/Linux app idle detection uses [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor).
