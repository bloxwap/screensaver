# Screensaver website and release backlog

[Tracking issue #2](https://github.com/bloxwap/screensaver/issues/2) owns the site, four editions, desktop downloads, and live previews. Screensaver issues belong to the [website and first public release milestone](https://github.com/bloxwap/screensaver/milestone/1).

GitHub issue state is the completion record. Each task needs its implementation PR and verification evidence; this table defines scope and execution order.

| Task | Priority | Depends on | Completion evidence |
| --- | --- | --- | --- |
| [#3 Workspace and contracts](https://github.com/bloxwap/screensaver/issues/3) | P0 | [PR #1](https://github.com/bloxwap/screensaver/pull/1) | Clean checkout builds renderer, docs, and desktop staging. |
| [#4 Four asset editions](https://github.com/bloxwap/screensaver/issues/4) | P0 | #3 | Asset/market tests and live smoke checks for BTC, SOL, ETH, HYPE. |
| [#5 Download page](https://github.com/bloxwap/screensaver/issues/5) | P1 | #3 | Correct 4 × 3 mappings, four preview links, empty states, responsive/keyboard review. |
| [#6 Browser/local previews](https://github.com/bloxwap/screensaver/issues/6) | P0 | #4, #5 | Direct reload, lifecycle, offline, fullscreen, service-worker scope checks. |
| [#7 Native/desktop packaging](https://github.com/bloxwap/screensaver/issues/7) | P0 | #4 | Mac `.saver` DMG/ZIP and Windows/Linux apps across native runners, identities, selected asset, coexistence. |
| [#8 Signing/distribution](https://github.com/bloxwap/screensaver/issues/8) | P0 | #7 | Mac bundle signing/notarization/system-host results and Windows/Linux app install/tray/idle/uninstall. |
| [#9 Releases/manifest](https://github.com/bloxwap/screensaver/issues/9) | P0 | #7 | Matrix validation, public downloads/hashes, website refresh. |
| [#10 User docs](https://github.com/bloxwap/screensaver/issues/10) | P1 | #5, #6, #7 | Build/link checks and documented run/install paths. |
| [#11 CI/Pages](https://github.com/bloxwap/screensaver/issues/11) | P1 | #5, #6, #9, #10 | Passing checks and deployed routes/resources. |
| [#12 Complete release](https://github.com/bloxwap/screensaver/issues/12) | P0 | #8, #9, #10, #11 | Public 4 × 3 download checklist, four previews, native evidence. |
| [Directory #37](https://github.com/bloxwap/bloxwap.github.io/issues/37) | P1 | #12 | Live directory card linking to the canonical site. |
| [#14 Native macOS screen saver](https://github.com/bloxwap/screensaver/issues/14) | P0 | #4, #7 | Native `.saver` packaging, shared rendering, system installation/selection, harness and actual macOS-host evidence; updates #8/#12 release gates. |

P0 and P1 tasks are both required. Asset support and the landing page follow the workspace contract; preview and packaging then progress independently. Release automation can be implemented before signing credentials are ready. Signed stable publication remains gated on verified distribution.

## Native macOS requirement

The `0.2.x` Mac release uses a native `ScreenSaverView` + `WKWebView` `.saver` bundle installed in a Screen Savers folder and selected through macOS settings. The OS owns activation, preview, dismissal, lock behavior, and display placement. Windows/Linux retain the Electron app host. Shared web rendering and all four assets remain unchanged in scope.

[Task #14](https://github.com/bloxwap/screensaver/issues/14) requires bundle metadata/architecture checks, native harness tests, and actual system-host preview/activation results. A minimum deployment target does not establish that every newer macOS host has been verified. Keep real-host compatibility failures open and documented. Archived `0.1.x` Mac apps stay accurately labeled, with migration instructions for quitting/removing the older app.

## Local verification

```sh
npm ci
npm test
npm run build
npm run docs:check
npm run docs:build
npx playwright install chromium webkit
npm run test:browser
npm run test:site
npm run docs:preview
```

The static site is served at `http://127.0.0.1:3907/screensaver/`. Verify preview URLs, downloads, and internal links at that base path. See [RELEASE.md](../../RELEASE.md) for publication, rollback, and final evidence.

## Separate verification evidence

Fixture tests establish behavior against controlled input. Live data, downloaded installers on each OS, signing credentials, and notarization need their own results. Public unsigned previews may ship with accurate status while stable signing and native certification remain open.
