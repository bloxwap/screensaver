import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CATALOG, EMPTY_MANIFEST, checksumText, createManifest, downloadKind, expectedDownloads, normalizeManifest, releaseAssetUrl, releaseNotes, releaseResumeState, validateManifest, verifyReleaseAssets } from './lib/releases.mjs';
import { fetchCurrentRelease, fetchReleaseManifest } from './fetch-release.mjs';

const version = '0.2.0';
const sha = 'a'.repeat(64);
function manifest(channel = 'preview', { legacy = false } = {}) {
  const tag = channel === 'stable' ? `v${version}` : `preview-v${version}-abcdef0-1-1`;
  return {
    schemaVersion: 1, version, tag, publishedAt: '2026-10-24T00:00:00.000Z', channel,
    releaseUrl: `https://github.com/bloxwap/screensaver/releases/tag/${tag}`,
    downloads: expectedDownloads(version).map((entry) => ({ ...entry, ...(!legacy ? { kind: entry.platform === 'macos' ? 'screensaver' : 'application' } : {}), url: releaseAssetUrl(tag, entry.filename), size: 1234, sha256: sha, signed: channel === 'stable' && entry.platform !== 'linux' })),
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
    if (!groups.has(key)) groups.set(key, { schemaVersion: 1, platform: entry.platform, asset: entry.asset, arch: entry.arch, version, channel, files: [] });
    groups.get(key).files.push({ filename: entry.filename, sha256: createHash('sha256').update(content).digest('hex'), kind: entry.platform === 'macos' ? 'screensaver' : 'application', ...(entry.platform === 'macos' ? { verification: 'embedded-screensaver' } : {}), signed: channel === 'stable' && entry.platform !== 'linux', notarized: channel === 'stable', timestamped: channel === 'stable' });
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
    (data) => { data.downloads[0].kind = 'unknown'; },
    (data) => { data.downloads.find((entry) => entry.platform === 'windows').kind = 'screensaver'; },
    (data) => { data.downloads[0].kind = 'application'; },
  ];
  for (const edit of edits) { const data = manifest(); edit(data); assert.throws(() => validateManifest(data)); }
  const data = manifest('stable'); data.downloads[0].signed = false;
  assert.throws(() => validateManifest(data), /not signed/);
});

test('legacy manifests remain applications and cannot pass the new native-publication contract', () => {
  const legacy = manifest('preview', { legacy: true });
  assert.equal(validateManifest(legacy), legacy);
  assert.equal(downloadKind(legacy.downloads[0]), 'application');
  const normalized = normalizeManifest(legacy);
  assert.ok(normalized.downloads.every((entry) => entry.kind === 'application'));
  assert.equal(legacy.downloads[0].kind, undefined, 'normalization does not rewrite legacy metadata in place');
  assert.throws(() => validateManifest(legacy, { requireCurrentKinds: true }), /explicit screensaver kind/);
  assert.throws(() => validateManifest(normalized, { requireCurrentKinds: true }), /explicit screensaver kind/);
  assert.equal(validateManifest(manifest(), { requireCurrentKinds: true }).downloads[0].kind, 'screensaver');
});

test('generator hashes actual downloads and ignores unpacked applications and native screensaver bundles', async (t) => {
  const args = await fixture(t);
  const unpacked = join(args.directory, 'BTC-windows-x64', 'win-unpacked');
  await mkdir(unpacked);
  await writeFile(join(unpacked, 'bloxwap-screensaver-bitcoin.exe'), 'development app');
  const bundle = join(args.directory, 'BTC-macos-arm64', 'Bloxwap Bitcoin Screensaver.saver', 'Contents', 'Resources');
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, 'internal.zip'), 'bundled resource, not a public download');
  const data = await createManifest(args);
  assert.equal(data.downloads.length, 28);
  assert.equal(data.downloads[0].size, Buffer.byteLength(`test installer ${data.downloads[0].filename}`));
  assert.match(checksumText(data), /^[a-f0-9]{64}  bloxwap-screensaver-bitcoin/);
  assert.ok(data.downloads.filter((entry) => entry.platform === 'macos').every((entry) => entry.kind === 'screensaver'));
  assert.ok(data.downloads.filter((entry) => entry.platform !== 'macos').every((entry) => entry.kind === 'application'));
});

test('new releases require actual native-bundle evidence and cannot relabel old Mac application proofs', async (t) => {
  const args = await fixture(t);
  const path = join(args.directory, 'BTC-macos-arm64', 'signing.json');
  const original = JSON.parse(await readFile(path, 'utf8'));
  for (const change of [
    (report) => { delete report.files[0].kind; },
    (report) => { report.files[0].kind = 'application'; },
    (report) => { report.files[0].verification = 'embedded-application'; },
    (report) => { delete report.files[0].verification; },
    (report) => { report.asset = 'ETH'; },
    (report) => { report.arch = 'x64'; },
    (report) => { report.version = '0.1.0'; },
  ]) {
    const changed = structuredClone(original); change(changed);
    await writeFile(path, JSON.stringify(changed));
    await assert.rejects(createManifest(args), /actual screensaver|embedded screensaver evidence|different asset, version, or architecture/);
  }
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
  report.files[0].notarized = true;
  report.files[0].verification = 'embedded-application';
  await writeFile(path, JSON.stringify(report));
  await assert.rejects(createManifest(args), /embedded screensaver evidence/);
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

test('draft verification accepts GitHub provisional URLs only with exact repository, filename, and hash proof', () => {
  const data = manifest();
  const draft = release(data);
  draft.draft = true;
  for (const asset of draft.assets) asset.browser_download_url = asset.browser_download_url.replace(`/${data.tag}/`, '/untagged-39be751c1ea768624b57/');
  assert.throws(() => verifyReleaseAssets(data, draft), /missing or mismatched/);
  assert.equal(verifyReleaseAssets(data, draft, { allowDraft: true }), true);
  // A published release can never retain provisional URLs, even if this option is passed.
  assert.throws(() => verifyReleaseAssets(data, { ...draft, draft: false }, { allowDraft: true }), /missing or mismatched/);
  for (const change of [
    (item) => { item.assets[0].browser_download_url = item.assets[0].browser_download_url.replace('/bloxwap/screensaver/', '/another/repository/'); },
    (item) => { item.assets[0].browser_download_url += '?unexpected=1'; },
    (item) => { item.assets[0].browser_download_url = item.assets[0].browser_download_url.replace('untagged-39be751c1ea768624b57', 'some-other-tag'); },
    (item) => { item.assets[0].digest = null; },
  ]) { const invalid = structuredClone(draft); change(invalid); assert.throws(() => verifyReleaseAssets(data, invalid, { allowDraft: true })); }
});

test('publication retries resume only the same draft or an identical public release at the actual tag commit', () => {
  const data = manifest();
  const sourceSha = 'a'.repeat(40);
  const tagCommitSha = sourceSha;
  assert.equal(releaseResumeState(data, null, { sourceSha }), 'create');
  const draft = { ...release(data), draft: true, target_commitish: sourceSha };
  assert.equal(releaseResumeState(data, draft, { sourceSha }), 'resume-draft');
  assert.throws(() => releaseResumeState(data, { ...draft, target_commitish: 'b'.repeat(40) }, { sourceSha }), /different source commit/);
  const published = { ...release(data), target_commitish: 'main' };
  assert.equal(releaseResumeState(data, published, { sourceSha, tagCommitSha, publishedManifest: data }), 'verified-public');
  assert.throws(() => releaseResumeState(data, published, { sourceSha, tagCommitSha: 'b'.repeat(40) }), /different source commit/);
  assert.throws(() => releaseResumeState(data, { ...published, prerelease: false }, { sourceSha, tagCommitSha }), /different tag or channel/);
  for (const digest of [null, `sha256:${'b'.repeat(64)}`]) {
    const changed = structuredClone(published);
    changed.assets[0].digest = digest;
    assert.throws(() => releaseResumeState(data, changed, { sourceSha, tagCommitSha, publishedManifest: data }), /unchanged|checksum mismatch/);
  }
});

test('public release recovery cannot upgrade legacy app metadata into native screensaver claims', () => {
  const legacy = manifest('preview', { legacy: true });
  const claimedNative = manifest();
  const published = release(legacy);
  const sourceSha = 'a'.repeat(40);
  const options = { sourceSha, tagCommitSha: sourceSha, publishedManifest: legacy };
  assert.equal(releaseResumeState(legacy, published, options), 'verified-public');
  assert.throws(() => releaseResumeState(claimedNative, published, options), /change the kind or verification metadata/);
  assert.throws(() => releaseResumeState(legacy, published, { sourceSha, tagCommitSha: sourceSha }), /requires its published manifest/);
});

test('site refresh prefers stable over newer preview, and accepts preview before first stable release', async () => {
  const stable = manifest('stable');
  const preview = manifest(); preview.publishedAt = '2026-10-25T00:00:00Z';
  assert.equal((await fetchCurrentRelease({ fetchImpl: mockFetch([preview, stable]) })).tag, stable.tag);
  assert.equal((await fetchCurrentRelease({ fetchImpl: mockFetch([preview]) })).tag, preview.tag);
  assert.equal(await fetchCurrentRelease({ fetchImpl: mockFetch([]) }), null);
});

test('fetch preserves legacy Mac application meaning and adopts native kind only from the published manifest', async () => {
  const legacy = manifest('preview', { legacy: true });
  const oldResult = await fetchReleaseManifest(release(legacy), { fetchImpl: mockFetch([legacy]) });
  assert.ok(oldResult.downloads.every((entry) => entry.kind === 'application'));
  const native = manifest();
  const newResult = await fetchReleaseManifest(release(native), { fetchImpl: mockFetch([native]) });
  assert.ok(newResult.downloads.filter((entry) => entry.platform === 'macos').every((entry) => entry.kind === 'screensaver'));
  assert.ok(newResult.downloads.filter((entry) => entry.platform !== 'macos').every((entry) => entry.kind === 'application'));
});

test('release notes describe the actual Mac artifact kind without changing legacy claims', () => {
  const sourceSha = 'a'.repeat(40);
  const nativeNotes = releaseNotes(manifest(), sourceSha);
  assert.match(nativeNotes, /Mac downloads contain native \.saver plugins/);
  assert.match(nativeNotes, /Windows and Linux downloads are x64 desktop applications/);
  const oldNotes = releaseNotes(manifest('preview', { legacy: true }), sourceSha);
  assert.match(oldNotes, /Mac downloads contain desktop applications/);
  assert.doesNotMatch(oldNotes, /Mac downloads contain native/);
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
