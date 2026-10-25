const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateEdition, loadEdition, editionIdentity, editionQuery, isEditionPage } = require('./edition.cjs');

const catalog = [
  { symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin' },
  { symbol: 'SOL', name: 'Solana', slug: 'solana' },
  { symbol: 'ETH', name: 'Ethereum', slug: 'ethereum' },
  { symbol: 'HYPE', name: 'Hyperliquid', slug: 'hyperliquid' },
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screensaver-edition-'));
  const desktopDirectory = path.join(root, 'desktop');
  fs.mkdirSync(desktopDirectory);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, desktopDirectory };
}

test('a packaged edition uses its immutable build metadata, regardless of the launch environment', (t) => {
  const { desktopDirectory } = fixture(t);
  fs.writeFileSync(path.join(desktopDirectory, 'edition.json'), JSON.stringify(catalog[1]));
  const edition = loadEdition({ isPackaged: true, desktopDirectory, requestedAsset: 'ETH' });
  assert.deepEqual(edition, catalog[1]);
  assert.equal(Object.isFrozen(edition), true);
  // A packaged app needs no development catalog or private sibling checkout.
  assert.equal(editionQuery(edition).asset, 'SOL');
});

test('a missing or malformed packaged edition fails instead of silently opening Bitcoin', (t) => {
  const { desktopDirectory } = fixture(t);
  assert.throws(() => loadEdition({ isPackaged: true, desktopDirectory, requestedAsset: 'BTC' }), /ENOENT/);
  fs.writeFileSync(path.join(desktopDirectory, 'edition.json'), JSON.stringify({ ...catalog[0], symbol: 'UNKNOWN' }));
  assert.throws(() => loadEdition({ isPackaged: true, desktopDirectory }), /Invalid screensaver edition/);
});

test('development selects only catalog assets and defaults to Bitcoin', (t) => {
  const { root, desktopDirectory } = fixture(t);
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/assets.json'), JSON.stringify(catalog));
  assert.deepEqual(loadEdition({ isPackaged: false, desktopDirectory, requestedAsset: null }), catalog[0]);
  for (const edition of catalog) {
    assert.deepEqual(loadEdition({ isPackaged: false, desktopDirectory, requestedAsset: ` ${edition.symbol.toLowerCase()} ` }), edition);
  }
  for (const requestedAsset of ['', 'DOGE', '../BTC']) {
    assert.throws(() => loadEdition({ isPackaged: false, desktopDirectory, requestedAsset }), /Unknown screensaver asset/);
  }
});

test('editions keep distinct app identities, preferences, and browser sessions on each OS', () => {
  for (const [paths, appData] of [[path.posix, '/Users/test/Library/Application Support'], [path.posix, '/home/test/.config'], [path.win32, 'C:\\Users\\test\\AppData\\Roaming']]) {
    const identities = catalog.map((edition) => editionIdentity(edition, appData, paths));
    for (const key of ['appId', 'productName', 'userData', 'sessionData']) {
      assert.equal(new Set(identities.map((identity) => identity[key])).size, catalog.length);
    }
    assert.equal(identities[1].appId, 'com.bloxwap.screensaver.solana');
    assert.equal(identities[1].productName, 'Bloxwap Solana Screensaver');
    assert.equal(identities[1].userData, paths.join(appData, 'com.bloxwap.screensaver.solana'));
    assert.equal(identities[1].sessionData, paths.join(identities[1].userData, 'session'));
  }
});

test('normal, tray preview, and idle window query data retain the chosen edition', () => {
  for (const edition of catalog) {
    assert.deepEqual(editionQuery(edition), { asset: edition.symbol });
    assert.deepEqual(editionQuery(edition, true), { asset: edition.symbol, mode: 'idle' });
  }
});

test('the privileged renderer boundary requires the exact local file and edition', () => {
  const pageURL = pathToFileURL('/tmp/Bloxwap Screensaver/dist/index.html').href;
  const edition = catalog[2];
  for (const suffix of ['?asset=ETH', '?asset=ETH&mode=idle', '?mode=idle&asset=ETH#controls']) {
    assert.equal(isEditionPage(pageURL + suffix, pageURL, edition), true, suffix);
  }
  for (const value of [
    pageURL,
    pageURL + '?asset=BTC',
    pageURL + '?asset=ETH&asset=BTC',
    pageURL + '?asset=ETH&mode=other',
    pageURL + '?asset=ETH&mode=idle&mode=other',
    pageURL.replace('index.html', 'other.html') + '?asset=ETH',
    'https://bloxwap.github.io/screensaver/preview/?asset=ETH',
    'file://other-host/tmp/Bloxwap%20Screensaver/dist/index.html?asset=ETH',
    'not a URL',
  ]) assert.equal(isEditionPage(value, pageURL, edition), false, value);
});

test('edition metadata discards extra fields and refuses unsafe filesystem identifiers', () => {
  assert.deepEqual(validateEdition({ ...catalog[0], idleEnabled: true, appId: 'override' }), catalog[0]);
  for (const slug of ['../bitcoin', '/bitcoin', '..', 'bitcoin/ethereum', 'bitcoin\\ethereum', '', 'BTC']) {
    assert.throws(() => validateEdition({ ...catalog[0], slug }), /Invalid screensaver edition/);
  }
  for (const name of ['', 'Bitcoin\nOther', '<Bitcoin>', 'x'.repeat(41)]) {
    assert.throws(() => validateEdition({ ...catalog[0], name }), /Invalid screensaver edition/);
  }
});
