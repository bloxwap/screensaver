# Bloxwap HIG tokens

This unmodified token package is the same candidate used by the sibling Haptic site.
It keeps the screensaver documentation on Bloxwap's canonical colors, spacing, typography,
and motion roles without requiring a private checkout or an unpublished registry version.

- Source: [bloxwap/hig@872906a9071469af8714b3b6fb5cc7bd64d2d6f3](https://github.com/bloxwap/hig/tree/872906a9071469af8714b3b6fb5cc7bd64d2d6f3).
- Package: `@bloxwap/hig-tokens@0.1.0-candidate.sha872906a9`.
- License: MIT, included in the tarball and in `public/licenses/hig-tokens-MIT.txt`.
- SHA-256: `62b4007b5e06ee571352f8a33bd7e14025745fe42234d8532092739ff49f6196`.

Only the documentation workspace consumes this package; desktop bundles do not include it.
To update, replace the archive from a reviewed HIG revision, update the package dependency
and checksum together, then rebuild and inspect the documentation. Bloxwap fonts are
provided by `@bloxwap/font` under the SIL Open Font License.
