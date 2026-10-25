# Screensaver releases

The [Desktop installers workflow](https://github.com/bloxwap/screensaver/actions/workflows/desktop.yml) owns desktop builds and public release assets. The [Documentation workflow](https://github.com/bloxwap/screensaver/actions/workflows/docs.yml) deploys the site from a verified release manifest.

## Build matrix

Each of BTC, SOL, ETH, and HYPE produces these files:

| OS | Architecture | Formats |
| --- | --- | --- |
| macOS 13+ | arm64 | DMG, ZIP |
| macOS 13+ | x64 | DMG, ZIP |
| Windows | x64 | NSIS EXE |
| Linux | x64 | AppImage, DEB |

A complete release has 28 installers/archives. Names are `bloxwap-screensaver-{asset-slug}-{version}-{os}-{arch}.{format}`. Separate package identities and preferences let editions coexist. Record tested Windows versions and Linux distributions/sessions in each release's evidence.

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
3. Run the required local and CI checks on the intended commit.
4. Create and push a `v{version}` tag matching `package.json`.
5. Confirm the matrix, Mac signing/notarization, Windows signing, checksums, and aggregate validation pass.
6. Verify the public site and downloaded artifacts before closing the launch task.

Stable publication fails when required credentials or signing verification are missing. [SIGNING.md](.github/SIGNING.md) lists credential names and verification commands. Store credentials in the configured release environment; pull-request workflows must not need them.

## Download manifest and site refresh

Every public release contains `SHA256SUMS` and `release-manifest.json`. The manifest records asset, OS, architecture, version, public URL, filename, bytes, SHA-256, and signing status.

The homepage consumes `config/releases.json` at build time. URLs point to a specific public release without GitHub authentication. An empty manifest renders unavailable states.

Build from the latest valid stable release, or the latest preview when no stable release exists:

```sh
node scripts/fetch-release.mjs
npm run docs:check
npm run docs:build
npm run docs:preview
```

Use `node scripts/fetch-release.mjs --tag TAG` to select a release. The release workflow explicitly dispatches the documentation refresh with its published tag.

Malformed, incomplete, or failed release data must not overwrite the last known-good manifest. Review `config/releases.json` before committing a manually selected manifest.

## Reruns and rollback

Inspect the failed job before rerunning it. A rerun must validate the entire expected set and must not mix different source versions. Use a new preview release for a new commit, keeping published download URLs stable.

For a website rollback, select a previous verified tag and rebuild/redeploy the docs from its manifest. Confirm the displayed version and URLs match that tag. Preserve newer artifacts for diagnosis; rollback does not require deleting public releases.

## Release evidence

Record the tag, commit, workflow run, artifact hashes, and tested OS/browser versions in [launch issue #12](https://github.com/bloxwap/screensaver/issues/12).

- Check all 12 asset × OS choices without GitHub sign-in, including every advertised architecture and format.
- Install and launch downloaded editions on their supported OS. Check the asset, QR, independent preferences, tray, optional idle activation, and uninstall.
- Record native signature/notarization results for signed releases. Browser tests and packaging success do not establish native installation behavior.
- Open four live previews; check fullscreen exit, return navigation, stale/offline behavior, keyboard controls, reduced motion, and mobile layout.
- Check deployed homepage/docs/search, icons/fonts, and direct preview URLs under `/screensaver/`.
- Leave unfinished platform checks and unavailable credentials open in GitHub. Close the parent after the directory entry and full launch verification are complete.
