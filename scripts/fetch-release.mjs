import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checksumText, EMPTY_MANIFEST, REPOSITORY, validateManifest, verifyReleaseAssets } from './lib/releases.mjs';

const API = `https://api.github.com/repos/${REPOSITORY}`;

async function response(url, { api = false, fetchImpl = fetch } = {}) {
  const headers = { Accept: api ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'bloxwap-screensaver-release' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (api && token) headers.Authorization = `Bearer ${token}`;
  if (api) headers['X-GitHub-Api-Version'] = '2026-03-10';
  const result = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!result.ok) throw new Error(`Release request returned HTTP ${result.status}`);
  return result;
}

export async function fetchReleaseManifest(release, { fetchImpl = fetch } = {}) {
  if (release.draft) throw new Error('Draft releases are not public downloads');
  const manifestAsset = release.assets?.find((asset) => asset.name === 'release-manifest.json');
  const checksumsAsset = release.assets?.find((asset) => asset.name === 'SHA256SUMS');
  if (!manifestAsset || !checksumsAsset) throw new Error('Release has no verified manifest/checksums');
  const prefix = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/`;
  if (manifestAsset.browser_download_url !== `${prefix}release-manifest.json` || checksumsAsset.browser_download_url !== `${prefix}SHA256SUMS`) throw new Error('Unexpected release metadata URL');
  if (manifestAsset.size > 1_000_000 || checksumsAsset.size > 100_000) throw new Error('Release metadata is unexpectedly large');
  const manifest = validateManifest(await (await response(manifestAsset.browser_download_url, { fetchImpl })).json());
  verifyReleaseAssets(manifest, release);
  const checksums = await (await response(checksumsAsset.browser_download_url, { fetchImpl })).text();
  if (checksums.replaceAll('\r\n', '\n') !== checksumText(manifest)) throw new Error('Published checksums do not match the release manifest');
  return manifest;
}

export async function fetchCurrentRelease({ tag, fetchImpl = fetch, log = console.warn } = {}) {
  if (tag) {
    const release = await (await response(`${API}/releases/tags/${encodeURIComponent(tag)}`, { api: true, fetchImpl })).json();
    return fetchReleaseManifest(release, { fetchImpl });
  }
  const releases = await (await response(`${API}/releases?per_page=100`, { api: true, fetchImpl })).json();
  if (!Array.isArray(releases)) throw new Error('Invalid GitHub releases response');
  const candidates = releases.filter((release) => !release.draft).sort((a, b) => Number(a.prerelease) - Number(b.prerelease) || Date.parse(b.published_at) - Date.parse(a.published_at));
  for (const release of candidates) {
    try { return await fetchReleaseManifest(release, { fetchImpl }); }
    catch (error) { log(`Skipped release ${release.tag_name}: ${error.message}`); }
  }
  if (candidates.length) throw new Error('No complete verified public release found; keeping the existing manifest');
  return null;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { tag: { type: 'string' }, output: { type: 'string', default: 'config/releases.json' } } });
  const manifest = await fetchCurrentRelease({ tag: values.tag });
  const output = resolve(values.output);
  if (!manifest) {
    try {
      validateManifest(JSON.parse(await readFile(output, 'utf8')));
      console.log('No public release yet; keeping the existing download manifest.');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const next = manifest ?? EMPTY_MANIFEST;
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
  await rename(temporary, output);
  console.log(next.channel === 'unreleased' ? 'No public release yet.' : `Using ${next.channel} ${next.tag}: ${next.downloads.length} verified downloads.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
