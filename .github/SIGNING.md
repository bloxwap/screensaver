# Desktop signing and verification

Preview releases are public builds without a verified publisher signature. Native macOS `.saver` bundles receive an ad-hoc signature so Apple Silicon can load their code; this is not a verified publisher identity. The website labels previews as unsigned. Signing does not guarantee Windows SmartScreen reputation or eliminate every OS prompt.

Stable releases require native platform verification of the actual downloadable files. Credential presence is a preflight check, not verification evidence. No signing credentials or native install results are included in this repository.

## Credentials

Configure these as GitHub Actions secrets for the protected release environment. Never expose them to pull-request or preview jobs.

| Platform | Environment variables | Purpose |
| --- | --- | --- |
| Mac | `CSC_LINK`, `CSC_KEY_PASSWORD` | Password-protected Developer ID Application certificate, as supported by electron-builder |
| Mac | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization account; use an app-specific password |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Password-protected code-signing certificate |

The Mac preflight also accepts the complete `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` set, or a preconfigured `APPLE_KEYCHAIN_PROFILE`. `APPLE_API_KEY` must point to a private `.p8` file; CI using that method must materialize it privately and remove it afterward. The provided workflow uses the Apple ID method. Windows accepts `CSC_LINK` / `CSC_KEY_PASSWORD` as a local fallback.

An incomplete Apple ID set is an error even when an API key is also present. Preview builds strip certificate, Apple, and Azure signing variables before packaging. Native signing imports the Developer ID certificate into a temporary keychain, grants only signing-tool access, and restores the original keychain search list in cleanup. Certificate and keychain passwords go to `security -i` through stdin. Notarization credentials go to `notarytool store-credentials` through its stdin prompts; subsequent submissions use the temporary profile. Secrets are never placed in process arguments or logged. The certificate copy and temporary keychain are removed on success and failure.

## Build configuration

Mac builds are native Swift `ScreenSaverView` plug-ins, packaged as a `.saver` inside the DMG and ZIP. `scripts/sign-macos-bundle.mjs` signs the bundle with Developer ID, hardened runtime, and a secure timestamp for stable releases. It does not apply Electron JIT, library-validation, or App Sandbox entitlements to the plug-in. The operating system owns the screen saver host and its privileges.

The helper notarizes the ZIP containing the exact signed `.saver`, then signs, notarizes, and staples the DMG. ZIP files cannot be stapled, and plug-in bundles must not be treated as `.app` containers: ZIP installation may require an online ticket lookup; the DMG carries a stapled distribution ticket. Windows continues to use the pinned electron-builder signing support.

Stable Windows builds use SHA-256 signing and an RFC 3161 timestamp. Missing credentials fail before packaging. Build settings are in `scripts/lib/desktop-config.cjs` and `scripts/macos-build.mjs`.

```sh
node scripts/signing-preflight.mjs --platform macos --channel stable
node scripts/verify-signing.mjs --platform macos --channel stable --directory release/bitcoin-macos-arm64
```

Use `windows` or `linux` for the other platforms. Preview builds use `--channel preview`.

## Release evidence

`verify-signing.mjs` writes `signing.json` into one edition/platform/architecture output directory. Every downloadable artifact gets a SHA-256 digest; the report also records its channel, asset, version, architecture, kind, and platform verification result. Mac files have `kind: "screensaver"`; Windows/Linux files have `kind: "application"`. An unsuccessful verification removes any previous report so stale evidence cannot be published.

- Mac, including previews: extract each ZIP and mount each DMG read-only. Require the expected `.saver` and reject `.app` payloads. Validate the BNDL metadata, principal class, immutable asset, version, executable architecture, Mach-O bundle type, renderer resources, and absence of Electron code. Verify the actual bundle signature. Stable verification additionally requires Developer ID and hardened runtime, then runs `codesign -R=notarized --check-notarization` on the plug-in. It checks the DMG signature and stapled ticket and uses `spctl --type open --context context:primary-signature` for the container. It does not use the app-only Gatekeeper execute assessment on a plug-in.
- Windows: use `Get-AuthenticodeSignature` on the unpacked application and downloadable installer. Require valid signatures, signer certificates, and timestamp certificates.
- Linux: record the AppImage and DEB hashes; do not claim publisher code signing.

The release aggregation verifies that reports match the exact uploaded hashes and kinds, and that stable Mac/Windows files satisfy the required signing flags. Keep fresh-user `.saver` installation, selection and preview in System Settings, automatic activation, display behavior, and uninstall results as separate native evidence. Windows/Linux app checks also cover tray and idle behavior. A valid signature or successful build does not prove those behaviors.

The local non-TTY `notarytool store-credentials` prompt flow was exercised with synthetic credentials and `--no-validate` in a disposable keychain; it stored the profile without echoing the password, then cleanup removed the keychain and restored the search list. This validates credential transport only. Real Developer ID credentials, Apple acceptance, and fresh-user installation still require release-environment evidence.

References: [Apple Screen Saver bundles](https://developer.apple.com/documentation/screensaver), [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow), [Apple notarization troubleshooting](https://developer.apple.com/documentation/security/resolving-common-notarization-issues), [Apple plug-in assessment discussion](https://developer.apple.com/forums/thread/129024), and [electron-builder v26 Windows signing options](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/).
