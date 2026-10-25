# Desktop signing and verification

Preview releases are public builds without a verified publisher signature. macOS previews receive an ad-hoc signature so modified Apple Silicon executables can launch; this is not a verified publisher identity, and preview hardened runtime is disabled to avoid ad-hoc library-validation failures. The website labels previews as unsigned. Signing does not guarantee Windows SmartScreen reputation or eliminate every OS prompt.

Stable releases require native platform verification of the actual downloadable files. Credential presence is a preflight check, not verification evidence. No signing credentials or native install results are included in this repository.

## Credentials

Configure these as GitHub Actions secrets for the protected release environment. Never expose them to pull-request or preview jobs.

| Platform | Environment variables | Purpose |
| --- | --- | --- |
| Mac | `CSC_LINK`, `CSC_KEY_PASSWORD` | Password-protected Developer ID Application certificate, as supported by electron-builder |
| Mac | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization account; use an app-specific password |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Password-protected code-signing certificate |

The Mac preflight also accepts the complete `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` set, or a preconfigured `APPLE_KEYCHAIN_PROFILE`. `APPLE_API_KEY` must resolve to the temporary `.p8` file expected by the installed notarization library; CI using that method must materialize it privately and remove it afterward. Do not pass the key contents in shell arguments. The provided workflow uses the Apple ID method. Windows accepts `CSC_LINK` / `CSC_KEY_PASSWORD` as a local fallback.

Preflight follows electron-builder's credential precedence. An incomplete Apple ID set is an error even when an API key is also present. Preview builds strip certificate, Apple, and Azure signing variables and disable identity discovery before invoking electron-builder.

## Build configuration

The pinned electron-builder handles signing, notarization, and stapling directly; no custom `afterSign` hook or additional notarization package is needed. Stable Mac builds require code signing, hardened runtime, and notarization. The app and helpers use `scripts/entitlements.mac.plist` with the JIT entitlement needed by modern Electron. It does not add legacy unsigned-memory, library-validation, or App Sandbox exceptions.

Stable Windows builds use SHA-256 signing and an RFC 3161 timestamp. Missing credentials fail before packaging. Build settings are in `scripts/lib/desktop-config.cjs`.

```sh
node scripts/signing-preflight.mjs --platform macos --channel stable
node scripts/verify-signing.mjs --platform macos --channel stable --directory release/bitcoin-macos-arm64
```

Use `windows` or `linux` for the other platforms. Preview builds use `--channel preview`.

## Release evidence

`verify-signing.mjs` writes `signing.json` into one edition/platform/architecture output directory. Every downloadable artifact gets a SHA-256 digest; the report also records its channel, identity, version, and platform verification result. An unsuccessful verification removes any previous report so stale evidence cannot be published.

- Mac: extract each ZIP and mount each DMG read-only. Verify the enclosed application with `codesign --verify --deep --strict`, require a Developer ID Application identity and hardened runtime, run `spctl --assess`, and validate the app's stapled ticket with `xcrun stapler validate`. The manifest's signing status refers to this enclosed app, not a separate signature on the ZIP container.
- Windows: use `Get-AuthenticodeSignature` on the unpacked application and downloadable installer. Require valid signatures, signer certificates, and timestamp certificates.
- Linux: record the AppImage and DEB hashes; do not claim publisher code signing.

The release aggregation verifies that reports match the exact uploaded file hashes and that stable Mac/Windows files satisfy the required signing flags. Keep fresh-user installation, launch, idle/tray/multiple-display checks, and uninstall results as separate platform evidence. A valid signature or successful build does not prove those behaviors.

References: [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [electron-builder v26 notarization](https://www.electron.build/v26/docs/features/code-signing/notarization/), [v26 Windows signing options](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/), and [modern Electron notarization entitlements](https://packages.electronjs.org/notarize/main/index.html).
