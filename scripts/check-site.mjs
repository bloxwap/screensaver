import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './lib/releases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'apps/docs/out');
const build = JSON.parse(await readFile(resolve(output, '_build.json'), 'utf8'));
const basePath = build.basePath;
const origin = 'https://bloxwap.github.io';
const failures = [];
const exists = async (path) => {
  try { return (await stat(path)).isFile(); } catch { return false; }
};
async function walk(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
}

for (const path of ['index.html', 'docs/index.html', '404.html', 'search.json', 'sitemap.xml', 'robots.txt', '.nojekyll',
  'releases.json', 'preview/index.html', 'preview/manifest.webmanifest', 'preview/sw.js']) {
  if (!await exists(resolve(output, path))) failures.push(`Missing ${path}`);
}

const catalog = JSON.parse(await readFile(resolve(root, 'config/assets.json'), 'utf8'));
const release = validateManifest(JSON.parse(await readFile(resolve(output, 'releases.json'), 'utf8')));
const sourceRelease = validateManifest(JSON.parse(await readFile(resolve(root, 'config/releases.json'), 'utf8')));
if (JSON.stringify(release) !== JSON.stringify(sourceRelease)) failures.push('Exported release manifest differs from the website build input.');
if (build.releaseTag !== release.tag || build.version !== release.version) failures.push('Build metadata and release manifest disagree.');

const homepage = await readFile(resolve(output, 'index.html'), 'utf8');
const decodeAttribute = (value) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
const homepageLinks = [...homepage.matchAll(/\bhref="([^"]*)"/g)].map((match) => decodeAttribute(match[1]));
for (const asset of catalog) {
  const target = `${basePath}/preview/?asset=${asset.symbol}`;
  if (!homepageLinks.includes(target)) failures.push(`Homepage is missing preview link ${target}`);
  if (!await exists(resolve(output, asset.icon))) failures.push(`Missing homepage asset icon: ${asset.icon}`);
  if (!await exists(resolve(output, 'preview', asset.icon))) failures.push(`Missing renderer asset icon: ${asset.icon}`);
}
const downloads = new Set(release.downloads.map((entry) => entry.url));
for (const url of downloads) {
  if (!homepageLinks.includes(url)) failures.push(`Released download is missing from the homepage: ${url}`);
}
for (const url of homepageLinks.filter((url) => url.startsWith('https://github.com/bloxwap/screensaver/releases/download/'))) {
  if (!downloads.has(url)) failures.push(`Homepage advertises an unverified download: ${url}`);
}
if (homepageLinks.some((url) => url.includes('/actions/runs/') || url.includes('/actions/workflows/desktop'))) {
  failures.push('The download page links to an Actions artifact instead of a public release.');
}

const previewURL = new URL(`${basePath}/preview/`, origin);
for (const symbol of [null, ...catalog.map((asset) => asset.symbol)]) {
  const name = symbol ? `manifest-${symbol.toLowerCase()}.webmanifest` : 'manifest.webmanifest';
  const path = resolve(output, 'preview', name);
  if (!await exists(path)) { failures.push(`Missing preview/${name}`); continue; }
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const key of ['scope', 'start_url']) {
    const value = manifest[key];
    if (typeof value !== 'string' || !new URL(value, previewURL).pathname.startsWith(previewURL.pathname)) {
      failures.push(`${name} ${key} escapes ${previewURL.pathname}`);
    }
  }
  if (symbol && new URL(manifest.start_url, previewURL).searchParams.get('asset') !== symbol) failures.push(`${name} loses the selected asset on launch.`);
}
if (await exists(resolve(output, 'sw.js'))) failures.push('A service worker at the site root could capture the landing page and documentation.');

const files = await walk(output);
for (const path of files.filter((file) => ['.html', '.css'].includes(extname(file)))) {
  const name = relative(output, path).split(sep).join('/');
  const text = await readFile(path, 'utf8');
  const documentPath = name.endsWith('index.html') ? name.slice(0, -'index.html'.length) : name;
  const current = new URL(`${basePath}/${documentPath}`, origin);
  const references = extname(path) === '.html'
    ? [...text.matchAll(/\b(?:href|src)="([^"<>]+)"/g)].map((match) => decodeAttribute(match[1]))
    : [...text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map((match) => match[1]);
  for (const value of references) {
    if (value.startsWith('#') || /^(?:data:|mailto:|tel:|javascript:|blob:)/.test(value)) continue;
    let url;
    try { url = new URL(value, current); } catch { failures.push(`${name}: invalid URL ${value}`); continue; }
    if (url.origin !== origin) continue;
    // Absolute links to other organization projects are intentional; root-relative ones must retain this site's base.
    if (/^https?:\/\//.test(value) && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) continue;
    if (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      failures.push(`${name}: URL is missing base path ${basePath}: ${value}`);
      continue;
    }
    let decoded;
    try { decoded = decodeURIComponent(url.pathname.slice(basePath.length)); } catch { failures.push(`${name}: invalid path encoding ${value}`); continue; }
    const local = resolve(output, `.${decoded}`);
    if (local !== output && !local.startsWith(`${output}${sep}`)) { failures.push(`${name}: URL escapes output: ${value}`); continue; }
    if (!await exists(local) && !await exists(resolve(local, 'index.html'))) failures.push(`${name}: missing local target ${value}`);
  }
}

const previewAssets = files.filter((path) => path.startsWith(`${resolve(output, 'preview/assets')}${sep}`));
// @bloxwap/chart currently embeds its WASM kernel as base64; future versions may emit a file.
const hasWasmFile = previewAssets.some((path) => extname(path) === '.wasm');
const hasEmbeddedWasm = (await Promise.all(previewAssets.filter((path) => extname(path) === '.js').map(async (path) =>
  (await readFile(path, 'utf8')).includes('AGFzbQ')))).some(Boolean);
if (!hasWasmFile && !hasEmbeddedWasm) failures.push('The preview export is missing the chart WebAssembly kernel.');
if (failures.length) {
  console.error(`Website export failed:\n${[...new Set(failures)].map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`Website export verified: ${catalog.length} previews, ${downloads.size} release files, ${files.length} static files, base ${basePath || '/'}.`);
