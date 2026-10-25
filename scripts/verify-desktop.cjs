const path = require('node:path');
const { createRequire } = require('node:module');
const { desktopOptions } = require('./lib/desktop-config.cjs');

// Resolve through Electron Builder's dependency tree, including nested npm layouts.
const requireFromBuilder = createRequire(require.resolve('app-builder-lib'));
const asar = requireFromBuilder('@electron/asar');

function verifyDesktopArchive(archive, expected) {
  asar.uncache(archive);
  const files = new Set(asar.listPackage(archive).map((file) => file.replace(/^\//, '')));
  const required = [
    'package.json', 'desktop/edition.json', 'desktop/main.cjs', 'desktop/preload.cjs',
    'desktop/edition.cjs', 'desktop/idle.cjs', 'dist/index.html', 'dist/third-party-notices.txt',
    'dist/trayTemplate.png', `dist/brand/${expected.asset.symbol}.svg`,
    'dist/brand/BloxwapSans-Variable.woff2', 'dist/brand/BloxwapMono-Variable.woff2',
  ];
  for (const file of required) {
    if (!files.has(file)) throw new Error(`Packaged ${expected.asset.symbol} app is missing ${file}.`);
  }
  if ([...files].some((file) => /^(?:apps|node_modules|tests)\//.test(file) || /\.test\.[cm]?js$/.test(file))) {
    throw new Error('Packaged desktop app contains documentation, tests, or unbundled dependencies.');
  }
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  const edition = JSON.parse(asar.extractFile(archive, 'desktop/edition.json').toString());
  if (metadata.name !== expected.identity || metadata.version !== expected.version || metadata.screensaverAsset !== expected.asset.symbol || metadata.productName !== expected.productName) {
    throw new Error('Packaged application identity/version does not match the requested edition.');
  }
  if (['symbol', 'name', 'slug'].some((key) => edition[key] !== expected.asset[key])) {
    throw new Error('Packaged edition metadata does not match the requested asset.');
  }
  if (metadata.dependencies || metadata.devDependencies || metadata.workspaces) {
    throw new Error('Packaged application metadata must not include workspace or package dependencies.');
  }
  const html = asar.extractFile(archive, 'dist/index.html').toString();
  for (const [, href] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    if (!files.has(`dist/${href.slice(2)}`)) throw new Error(`Packaged renderer references a missing file: ${href}`);
  }
  if (![...files].some((file) => /^dist\/assets\/.+\.js$/.test(file))) throw new Error('Packaged application has no renderer JavaScript.');
  return { asset: edition.symbol, version: metadata.version, archive };
}

async function afterPack(context) {
  const options = desktopOptions({ asset: context.packager.config.extraMetadata.screensaverAsset });
  if (context.packager.appInfo.id !== options.appId) throw new Error('Packaged application ID differs from the edition ID.');
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : path.join(context.appOutDir, 'resources');
  verifyDesktopArchive(path.join(resources, 'app.asar'), options);
  console.log(`Verified packaged ${options.asset.symbol} identity, renderer assets, and notices.`);
}

module.exports = afterPack;
module.exports.verifyDesktopArchive = verifyDesktopArchive;
