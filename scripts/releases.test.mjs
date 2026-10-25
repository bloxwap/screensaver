import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CATALOG, EMPTY_MANIFEST, checksumText, createManifest, expectedDownloads, releaseAssetUrl, validateManifest, verifyReleaseAssets } from './lib/releases.mjs';
import { fetchCurrentRelease, fetchReleaseManifest } from './fetch-release.mjs';

const version = '0.1.0';
const sha = 'a'.repeat(64);
function manifest(channel = 'preview') {
  const tag = channel === 'stable' ? `v${version}` : `preview-v${version}-abcdef0-1-1`;
  return {
    schemaVersion: 1, version, tag, publishedAt: '2026-10-24T00:00:00.000Z', channel,
    releaseUrl: `https://github.com/bloxwap/screensaver/releases/tag/${tag}`,
    downloads: expectedDownloads(version).map((entry) => ({ ...entry, url: releaseAssetUrl(tag, entry.filename), size: 1234, sha256: sha, signed: channel === 'stable' && entry.platform !== 'linux' })),
  };
}
function release(data) {
  const base = `https://github.com/bloxwap/screensaver/releases/download/${data.tag}/`;
  return {
    tag_name: data.tag, draft: false, prerelease: data.channel === 'preview', published_at: data.publishedAt,
    assets: [
      ...data.downloads.map((entry) => ({ name: entry.filename, size: entry.size, digest: `sha256:${entry.sha256}`, browser_download_url: entry.url, state: 'uploaded' })),
      { name: 'release-manifest.json', size: 10000, browser_download_url: `${base}release-manifest.json`, state: 'uploaded' },
      { name: 'SHA256SUMS', size: 5000, browser_download_url: `${base}SHA256SUMS`, state: 'uploaded' },
    ],
  };
}
function mockFetch(manifests, releases = manifests.map(release)) {
  return async (url) => {
    if (url.includes('/releases?')) return new Response(JSON.stringify(releases));
    if (url.includes('/releases/tags/')) return new Response(JSON.stringify(releases.find((item) => url.endsWith(item.tag_name))));
    const data = manifests.find((item) => url.includes(`/${item.tag}/`));
    if (url.endsWith('/release-manifest.json') && data) return new Response(JSON.stringify(data));
    if (url.endsWith('/SHA256SUMS') && data) return new Response(checksumText(data));
    return new Response('not found', { status: 404 });
  };
}
async function fixture(t, channel = 'preview') {
  const directory = await mkdtemp(join(tmpdir(), 'screensaver-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const groups = new Map();
  for (const entry of expectedDownloads(version)) {
    const key = `${entry.asset}-${entry.platform}-${entry.arch}`;
    const folder = join(directory, key);
    await mkdir(folder, { recursive: true });
    const content = Buffer.from(`test installer ${entry.filename}`);
    await writeFile(join(folder, entry.filename), content);
    if (!groups.has(key)) groups.set(key, { schemaVersion: 1, platform: entry.platform, channel, files: [] });
    groups.get(key).files.push({ filename: entry.filename, sha256: createHash('sha256').update(content).digest('hex'), signed: channel === 'stable' && entry.platform !== 'linux', notarized: channel === 'stable', timestamped: channel === 'stable' });
  }
  for (const [key, proof] of groups) await writeFile(join(directory, key, 'signing.json'), JSON.stringify(proof));
  return { directory, version, tag: channel === 'stable' ? `v${version}` : `preview-v${version}-test`, channel };
}

test('contract covers four assets, twelve OS choices, and all 28 supported installer formats', () => {
  const expected = expectedDownloads(version);
  assert.equal(expected.length, 28);
  assert.deepEqual([...new Set(expected.map((entry) => entry.asset))], CATALOG.map((asset) => asset.symbol));
  assert.equal(new Set(expected.map((entry) => `${entry.asset}-${entry.platform}`)).size, 12);
  assert.equal(new Set(expected.map((entry) => entry.filename)).size, 28);
  assert.equal(validateManifest(EMPTY_MANIFEST), EMPTY_MANIFEST);
  assert.equal(validateManifest(manifest()).channel, 'preview');
  assert.equal(validateManifest(manifest('stable')).channel, 'stable');
});

test('validator rejects partial matrices, false asset labels, duplicate files, unsafe URLs, and unsupported architectures', () => {
  const edits = [
    (data) => data.downloads.pop(),
    (data) => { data.downloads[0].asset = 'SOL'; },
    (data) => { data.downloads[1] = data.downloads[0]; },
    (data) => { data.downloads[0].url = 'https://example.org/installer.dmg'; },
    (data) => { data.downloads[0].arch = 'universal'; },
    (data) => { data.downloads[0].size = 0; },
    (data) => { data.downloads[0].sha256 = 'not-a-checksum'; },
  ];
  for (const edit of edits) { const data = manifest(); edit(data); assert.throws(() => validateManifest(data)); }
  const data = manifest('stable'); data.downloads[0].signed = false;
  assert.throws(() => validateManifest(data), /not signed/);
});

test('generator hashes actual installers and ignores electron-builder unpacked applications', async (t) => {
  const args = await fixture(t);
  const unpacked = join(args.directory, 'BTC-windows-x64', 'win-unpacked');
  await mkdir(unpacked);
  await writeFile(join(unpacked, 'bloxwap-screensaver-bitcoin.exe'), 'development app');
  const data = await createManifest(args);
  assert.equal(data.downloads.length, 28);
  assert.equal(data.downloads[0].size, Buffer.byteLength(`test installer ${data.downloads[0].filename}`));
  assert.match(checksumText(data), /^[a-f0-9]{64}  bloxwap-screensaver-bitcoin/);
});

test('generator refuses missing and altered artifacts even when the signing report exists', async (t) => {
  const args = await fixture(t);
  const entry = expectedDownloads(version)[0];
  const path = join(args.directory, 'BTC-macos-arm64', entry.filename);
  await writeFile(path, 'changed after verification');
  await assert.rejects(createManifest(args), /mismatched signing evidence/);
  await rm(path);
  await assert.rejects(createManifest(args), /Expected 28/);
});

test('stable release requires notarization and timestamp proofs for each actual file', async (t) => {
  const args = await fixture(t, 'stable');
  assert.equal((await createManifest(args)).channel, 'stable');
  const path = join(args.directory, 'BTC-macos-arm64', 'signing.json');
  const report = JSON.parse(await readFile(path, 'utf8'));
  report.files[0].notarized = false;
  await writeFile(path, JSON.stringify(report));
  await assert.rejects(createManifest(args), /not signed and notarized/);
});

test('uploaded release verification detects missing, renamed, resized, and corrupted files', () => {
  const data = manifest();
  assert.equal(verifyReleaseAssets(data, release(data)), true);
  for (const change of [
    (item) => item.assets.shift(),
    (item) => { item.assets[0].size++; },
    (item) => { item.assets[0].digest = `sha256:${'b'.repeat(64)}`; },
    (item) => { item.assets[0].browser_download_url = 'https://example.org/fake'; },
    (item) => { item.prerelease = false; },
  ]) { const uploaded = release(data); change(uploaded); assert.throws(() => verifyReleaseAssets(data, uploaded)); }
});

test('site refresh prefers stable over newer preview, and accepts preview before first stable release', async () => {
  const stable = manifest('stable');
  const preview = manifest(); preview.publishedAt = '2026-10-25T00:00:00Z';
  assert.equal((await fetchCurrentRelease({ fetchImpl: mockFetch([preview, stable]) })).tag, stable.tag);
  assert.equal((await fetchCurrentRelease({ fetchImpl: mockFetch([preview]) })).tag, preview.tag);
  assert.equal(await fetchCurrentRelease({ fetchImpl: mockFetch([]) }), null);
});

test('bad releases cannot replace valid existing downloads; explicit bad tags fail', async () => {
  const older = manifest();
  const newer = manifest(); newer.tag = 'preview-broken'; newer.publishedAt = '2026-10-25T00:00:00Z';
  const bad = release(newer);
  const good = release(older);
  const logs = [];
  assert.equal((await fetchCurrentRelease({ fetchImpl: mockFetch([older], [bad, good]), log: (line) => logs.push(line) })).tag, older.tag);
  assert.equal(logs.length, 1);
  await assert.rejects(fetchCurrentRelease({ tag: newer.tag, fetchImpl: mockFetch([], [bad]) }), /HTTP 404/);
  await assert.rejects(fetchCurrentRelease({ fetchImpl: mockFetch([], [bad]), log: () => {} }), /keeping the existing manifest/);
});

test('drafts, missing checksum files, and untrusted metadata URLs cannot reach the website', async () => {
  const data = manifest();
  for (const change of [
    (item) => { item.draft = true; },
    (item) => { item.assets = item.assets.filter((asset) => asset.name !== 'SHA256SUMS'); },
    (item) => { item.assets.find((asset) => asset.name === 'release-manifest.json').browser_download_url = 'https://example.org/manifest.json'; },
  ]) { const item = release(data); change(item); await assert.rejects(fetchReleaseManifest(item, { fetchImpl: mockFetch([data]) })); }
  await assert.rejects(fetchReleaseManifest(release(data), { fetchImpl: async (url) => url.endsWith('SHA256SUMS') ? new Response('wrong checksum') : new Response(JSON.stringify(data)) }), /checksums do not match/);
});
