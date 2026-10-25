const fs = require('node:fs');
const path = require('node:path');

const SYMBOLS = new Set(['BTC', 'SOL', 'ETH', 'HYPE']);

/** Packaged edition metadata is generated from the shared asset catalog. */
function validateEdition(value) {
  if (!value || !SYMBOLS.has(value.symbol)
    || typeof value.name !== 'string' || !/^[A-Za-z][A-Za-z ]{0,39}$/.test(value.name)
    || typeof value.slug !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value.slug)) {
    throw new Error('Invalid screensaver edition metadata');
  }
  return Object.freeze({ symbol: value.symbol, name: value.name, slug: value.slug });
}

function loadEdition({ isPackaged, desktopDirectory, requestedAsset = process.env.SCREENSAVER_ASSET }) {
  if (isPackaged) {
    // A packaged edition never takes an asset override from the caller's environment.
    // Missing metadata is an invalid build, not an implicit Bitcoin edition.
    return validateEdition(JSON.parse(fs.readFileSync(path.join(desktopDirectory, 'edition.json'), 'utf8')));
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(desktopDirectory, '../config/assets.json'), 'utf8'));
  const symbol = requestedAsset == null ? 'BTC' : String(requestedAsset).trim().toUpperCase();
  const selected = Array.isArray(catalog) && catalog.find((asset) => asset.symbol === symbol);
  if (!selected) throw new Error(`Unknown screensaver asset: ${symbol}`);
  return validateEdition(selected);
}

function editionIdentity(value, appData, paths = path) {
  const edition = validateEdition(value);
  const appId = `com.bloxwap.screensaver.${edition.slug}`;
  const userData = paths.join(appData, appId);
  return Object.freeze({
    appId,
    productName: `Bloxwap ${edition.name} Screensaver`,
    userData,
    sessionData: paths.join(userData, 'session'),
  });
}

function editionQuery(value, idle = false) {
  const { symbol } = validateEdition(value);
  return idle ? { asset: symbol, mode: 'idle' } : { asset: symbol };
}

/** Only this edition's local renderer may navigate or use the privileged bridge. */
function isEditionPage(value, pageURL, edition) {
  try {
    const url = new URL(value);
    if (url.searchParams.getAll('asset').length !== 1 || url.searchParams.get('asset') !== edition.symbol) return false;
    if (url.searchParams.getAll('mode').length > 1) return false;
    const mode = url.searchParams.get('mode');
    if (mode !== null && mode !== 'idle') return false;
    url.search = '';
    url.hash = '';
    return url.href === pageURL;
  } catch { return false; }
}

module.exports = { validateEdition, loadEdition, editionIdentity, editionQuery, isEditionPage };
