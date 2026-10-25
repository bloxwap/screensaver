import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const REPOSITORY = 'bloxwap/screensaver';
export const CATALOG = JSON.parse(readFileSync(new URL('../../config/assets.json', import.meta.url), 'utf8'));
export const EMPTY_MANIFEST = Object.freeze({ schemaVersion: 1, version: null, tag: null, publishedAt: null, releaseUrl: null, channel: 'unreleased', downloads: [] });
export const TARGETS = Object.freeze([
  { platform: 'macos', arch: 'arm64', formats: ['dmg', 'zip'] },
  { platform: 'macos', arch: 'x64', formats: ['dmg', 'zip'] },
  { platform: 'windows', arch: 'x64', formats: ['exe'] },
  { platform: 'linux', arch: 'x64', formats: ['AppImage', 'deb'] },
]);
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TAG = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function expectedDownloads(version, catalog = CATALOG) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('Invalid release version');
  return catalog.flatMap((asset) => TARGETS.flatMap(({ platform, arch, formats }) => formats.map((format) => ({
    asset: asset.symbol, platform, arch, format,
    filename: `bloxwap-screensaver-${asset.slug}-${version}-${platform}-${arch}.${format}`,
  }))));
}

export function releaseAssetUrl(tag, filename, repository = REPOSITORY) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

/** Validate the complete public contract, including all 12 asset/OS choices and advertised architectures. */
export function validateManifest(manifest, { catalog = CATALOG, repository = REPOSITORY } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.downloads)) throw new Error('Invalid release manifest schema');
  if (manifest.channel === 'unreleased') {
    if (manifest.downloads.length || ['version', 'tag', 'publishedAt', 'releaseUrl'].some((key) => manifest[key] !== null)) throw new Error('Unreleased manifest must contain no downloads or version');
    return manifest;
  }
  if (!['preview', 'stable'].includes(manifest.channel)) throw new Error('Invalid release channel');
  if (typeof manifest.tag !== 'string' || !TAG.test(manifest.tag)) throw new Error('Invalid release tag');
  if (typeof manifest.publishedAt !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error('Missing release publication date');
  const expected = expectedDownloads(manifest.version, catalog);
  if (manifest.channel === 'stable' && (manifest.tag !== `v${manifest.version}` || manifest.version.includes('-'))) throw new Error('Stable tag must match the stable package version');
  if (manifest.releaseUrl !== `https://github.com/${repository}/releases/tag/${encodeURIComponent(manifest.tag)}`) throw new Error('Invalid release page URL');
  if (manifest.downloads.length !== expected.length) throw new Error(`Expected ${expected.length} installers, got ${manifest.downloads.length}`);
  const entries = new Map();
  for (const download of manifest.downloads) {
    if (!download || typeof download.filename !== 'string' || entries.has(download.filename)) throw new Error('Duplicate or invalid installer filename');
    if (!Number.isSafeInteger(download.size) || download.size <= 0 || !SHA256.test(download.sha256)) throw new Error(`Invalid size/checksum: ${download.filename}`);
    if (typeof download.signed !== 'boolean') throw new Error(`Missing signing status: ${download.filename}`);
    if (download.url !== releaseAssetUrl(manifest.tag, download.filename, repository)) throw new Error(`Invalid public installer URL: ${download.filename}`);
    if (manifest.channel === 'stable' && download.platform !== 'linux' && !download.signed) throw new Error(`Stable installer is not signed: ${download.filename}`);
    entries.set(download.filename, download);
  }
  for (const item of expected) {
    const actual = entries.get(item.filename);
    if (!actual || ['asset', 'platform', 'arch', 'format'].some((key) => actual[key] !== item[key])) throw new Error(`Missing or mismatched installer: ${item.filename}`);
  }
  return manifest;
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  // electron-builder keeps unpacked executables beside the distributable installers.
  const files = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) return /(?:\.app|-unpacked)$/.test(entry.name) || /^(mac|mac-arm64|mac-x64|mac-universal)$/.test(entry.name) ? [] : walk(join(directory, entry.name));
    return entry.isFile() ? [join(directory, entry.name)] : [];
  }));
  return files.flat();
}

export async function createManifest({ directory, version, tag, channel, publishedAt = new Date().toISOString(), catalog = CATALOG, repository = REPOSITORY }) {
  const expected = expectedDownloads(version, catalog);
  const files = await walk(directory);
  const installers = new Map();
  const proofs = new Map();
  for (const file of files) {
    const name = basename(file);
    if (/\.(dmg|zip|exe|AppImage|deb)$/.test(name)) {
      if (installers.has(name)) throw new Error(`Duplicate installer: ${name}`);
      installers.set(name, file);
    }
    if (name === 'signing.json') {
      const report = JSON.parse(await readFile(file, 'utf8'));
      if (report.schemaVersion !== 1 || report.channel !== channel || !Array.isArray(report.files)) throw new Error(`Invalid signing report: ${file}`);
      for (const proof of report.files) {
        if (proofs.has(proof.filename)) throw new Error(`Duplicate signing evidence: ${proof.filename}`);
        proofs.set(proof.filename, { ...proof, platform: report.platform });
      }
    }
  }
  if (installers.size !== expected.length) throw new Error(`Expected ${expected.length} installer files, got ${installers.size}`);
  const { stat } = await import('node:fs/promises');
  const downloads = [];
  for (const item of expected) {
    const file = installers.get(item.filename);
    if (!file) throw new Error(`Missing installer: ${item.filename}`);
    const proof = proofs.get(item.filename);
    const sha256 = await sha256File(file);
    if (!proof || proof.sha256 !== sha256 || proof.platform !== item.platform || typeof proof.signed !== 'boolean') throw new Error(`Missing or mismatched signing evidence: ${item.filename}`);
    if (channel === 'stable' && item.platform === 'macos' && (!proof.signed || !proof.notarized)) throw new Error(`Mac installer is not signed and notarized: ${item.filename}`);
    if (channel === 'stable' && item.platform === 'windows' && (!proof.signed || !proof.timestamped)) throw new Error(`Windows installer is not signed and timestamped: ${item.filename}`);
    downloads.push({ ...item, url: releaseAssetUrl(tag, item.filename, repository), size: (await stat(file)).size, sha256, signed: proof.signed });
  }
  return validateManifest({ schemaVersion: 1, version, tag, publishedAt, releaseUrl: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`, channel, downloads }, { catalog, repository });
}

export function checksumText(manifest) {
  validateManifest(manifest);
  return manifest.downloads.map(({ sha256, filename }) => `${sha256}  ${filename}\n`).join('');
}

/** Cross-check the manifest against actual uploaded GitHub assets, never inferred URL templates alone. */
export function verifyReleaseAssets(manifest, release) {
  validateManifest(manifest);
  if (release.tag_name !== manifest.tag || Boolean(release.prerelease) !== (manifest.channel === 'preview')) throw new Error('Release channel/tag does not match manifest');
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const entry of manifest.downloads) {
    const asset = assets.get(entry.filename);
    if (!asset || asset.size !== entry.size || asset.browser_download_url !== entry.url || asset.state !== 'uploaded') throw new Error(`Release asset missing or mismatched: ${entry.filename}`);
    if (asset.digest && asset.digest !== `sha256:${entry.sha256}`) throw new Error(`Uploaded artifact checksum mismatch: ${entry.filename}`);
  }
  return true;
}

/** Decide whether a retry can safely continue without replacing public binaries. */
export function releaseResumeState(manifest, release, { sourceSha, tagCommitSha = null } = {}) {
  validateManifest(manifest);
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Release recovery requires a full source commit SHA');
  if (!release) return 'create';
  if (release.tag_name !== manifest.tag || Boolean(release.prerelease) !== (manifest.channel === 'preview')) throw new Error('Existing release has a different tag or channel');
  if (release.draft) {
    if (release.target_commitish !== sourceSha && tagCommitSha !== sourceSha) throw new Error('Existing draft targets a different source commit');
    return 'resume-draft';
  }
  // target_commitish may be a moving branch name; resolve the actual tag commit.
  if (tagCommitSha !== sourceSha) throw new Error('Published release tag points to a different source commit');
  verifyReleaseAssets(manifest, release);
  for (const entry of manifest.downloads) {
    const uploaded = release.assets.find((asset) => asset.name === entry.filename);
    if (uploaded.digest !== `sha256:${entry.sha256}`) throw new Error(`Cannot prove the published artifact is unchanged: ${entry.filename}`);
  }
  return 'verified-public';
}
