# Screensaver releases

The [Desktop installers workflow](https://github.com/bloxwap/screensaver/actions/workflows/desktop.yml) owns desktop builds and public release assets. The [Documentation workflow](https://github.com/bloxwap/screensaver/actions/workflows/docs.yml) deploys the site from a verified release manifest.

## Build matrix

Each of BTC, SOL, ETH, and HYPE produces these files:

| OS | Architecture | Contents and formats |
| --- | --- | --- |
| macOS 13+ | arm64 | Native `.saver` bundle in DMG and ZIP |
| macOS 13+ | x64 | Native `.saver` bundle in DMG and ZIP |
| Windows | x64 | Electron app in NSIS EXE |
| Linux | x64 | Electron app in AppImage and DEB |

A complete release has 16 build targets and 28 installers/archives. Names are `bloxwap-screensaver-{asset-slug}-{version}-{os}-{arch}.{format}`. Separate bundle/app identities let editions coexist. macOS 13 is the native build's deployment target; record actual native host versions tested separately, alongside Windows versions and Linux distributions/sessions.

## Native Mac transition in 0.2

The `0.2.x` Mac distribution uses a Swift `ScreenSaverView` subclass with a `WKWebView` for the bundled display. DMG and ZIP files contain a `.saver` bundle, installed in `~/Library/Screen Savers` or `/Library/Screen Savers` and selected through macOS Screen Saver settings. macOS manages activation, preview, dismissal, lock behavior, and connected displays.

Archived `0.1.x` Mac artifacts remain Electron apps. Preserve their metadata and label them as apps when reading older manifests. Users migrating to the native saver should quit/remove the old Mac app separately before selecting the `.saver`; the native edition has no tray process or app idle timer. Windows and Linux continue to use the Electron host. [Task #14](https://github.com/bloxwap/screensaver/issues/14) tracks the native transition and verification.

## Public preview builds

Relevant changes on `main` build the full matrix and publish unsigned preview prereleases. PRs build representative platform/architecture candidates without publishing or production signing credentials.

Run a full preview from a chosen branch:

```sh
gh workflow run desktop.yml --ref BRANCH -f publish=true
gh run list --workflow desktop.yml
```

Replace `BRANCH` with the intended branch. Use `-f publish=false` for a build-only run. Public previews remain labeled unsigned in the manifest, release notes, and website.

The aggregate release job validates all expected artifacts before publication. Missing files, colliding identities, inconsistent versions, failed checks, and invalid metadata must leave the current download list intact.

## Signed stable releases

1. Complete [signing setup](.github/SIGNING.md) and native distribution checks in [#8](https://github.com/bloxwap/screensaver/issues/8).
2. Set the intended version in `package.json` and keep the lockfile consistent.
3. Run the required local and CI checks, then integrate the intended commit into `main`.
4. Create and push a `v{version}` tag matching `package.json`.
5. Confirm the matrix, native Mac bundle signing/notarization, Windows signing, checksums, and aggregate validation pass.
6. Verify the public site and downloaded artifacts before closing the launch task.

Stable publication fails when required credentials or signing verification are missing. [SIGNING.md](.github/SIGNING.md) lists credential names and verification commands. Store credentials in the configured release environment; pull-request workflows must not need them.

## Download manifest and site refresh

Every public release contains `SHA256SUMS` and `release-manifest.json`. The manifest records asset, OS, architecture, version, public URL, filename, bytes, SHA-256, signing status, and `kind`: `screensaver` for native Mac bundles or `application` for desktop apps. A missing `kind` in a legacy schema-1 entry means `application`, including on Mac. Preserve that meaning when reading archived releases; never relabel an old app artifact as a native saver.

The homepage consumes `config/releases.json` at build time. URLs point to a specific public release without GitHub authentication. An empty manifest renders unavailable states.

Build from the latest valid stable release, or the latest preview when no stable release exists:

```sh
node scripts/fetch-release.mjs
npm run docs:check
npm run docs:build
npm run docs:preview
```

Use `node scripts/fetch-release.mjs --tag TAG` to select a release. The release workflow explicitly dispatches the documentation refresh. Stable publication selects its tag; preview publication preserves a valid stable homepage when one already exists.

Malformed, incomplete, or failed release data must not overwrite the last known-good manifest. Review `config/releases.json` before committing a manually selected manifest.

## Reruns and rollback

Inspect the failed job before rerunning it. A rerun must validate the entire expected set and must not mix different source versions. Use a new preview release for a new commit, keeping published download URLs stable.

For a website rollback, select a previous verified tag and rebuild/redeploy the docs from its manifest. Confirm the displayed version and URLs match that tag. Preserve newer artifacts for diagnosis; rollback does not require deleting public releases.

## Release evidence

Record the tag, commit, workflow run, artifact hashes, and tested OS/browser versions in [launch issue #12](https://github.com/bloxwap/screensaver/issues/12).

The native build and standalone `ScreenSaverView`/`WKWebView` smoke check have passed on macOS 27.2. Sustained rendering inside the actual macOS System Settings/`legacyScreenSaver` host remains unverified. The [compatibility note](apps/docs/content/docs/troubleshooting.mdx#macos-host-compatibility) links the developer-reported macOS 26.4 issue; it does not establish a fix or a failure on every Mac. Keep real-host certification open in [#14](https://github.com/bloxwap/screensaver/issues/14).

- Check all 12 asset × OS choices without GitHub sign-in, including every advertised architecture and format.
- On Mac, inspect the archived `.saver`, install it in a Screen Savers folder, select it in macOS settings, and verify real system preview/activation/dismissal, the correct asset, connected-display behavior, and bundle removal. Test the actual macOS host as well as the standalone native harness.
- On Windows/Linux, install and launch the apps. Check the asset, QR, independent preferences, tray, optional idle activation, and uninstall.
- Record native signature/notarization results for signed releases. Browser tests and packaging success do not establish native installation behavior.
- Open four live previews; check fullscreen exit, return navigation, stale/offline behavior, keyboard controls, reduced motion, and mobile layout.
- Check deployed homepage/docs/search, icons/fonts, and direct preview URLs under `/screensaver/`.
- Leave unfinished platform checks and unavailable credentials open in GitHub. Close the parent after the directory entry and full launch verification are complete.
