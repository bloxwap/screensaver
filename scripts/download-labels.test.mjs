import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tsImport } from 'tsx/esm/api';
import assets from '../config/assets.json' with { type: 'json' };

// Render the production component with old and new public-release fixtures. This
// checks visible installation guidance and accessible download names together.
const { Downloads } = await tsImport('../apps/docs/components/downloads.tsx', {
  parentURL: import.meta.url,
  tsconfig: fileURLToPath(new URL('../apps/docs/tsconfig.json', import.meta.url)),
});

function macDownload(asset, format, kind) {
  const filename = `Bloxwap-${asset}-Screensaver-0.2.0-macos-arm64.${format}`;
  return {
    asset, platform: 'macos', arch: 'arm64', format, filename,
    url: `https://github.com/bloxwap/screensaver/releases/download/v0.2.0-preview.1/${filename}`,
    size: 10 * 1024 * 1024, sha256: 'a'.repeat(64), signed: false,
    ...(kind === undefined ? {} : { kind }),
  };
}

function render(downloads) {
  return renderToStaticMarkup(React.createElement(Downloads, {
    assets,
    manifest: {
      schemaVersion: 1, version: '0.2.0-preview.1', tag: 'v0.2.0-preview.1',
      publishedAt: '2026-10-24T00:00:00Z', channel: 'preview',
      releaseUrl: 'https://github.com/bloxwap/screensaver/releases/tag/v0.2.0-preview.1', downloads,
    },
  }));
}

function assetRow(html, symbol) {
  const match = html.match(new RegExp(`<tr[^>]*data-asset="${symbol}"[^>]*>[\\s\\S]*?</tr>`));
  assert.ok(match, `${symbol} download row is rendered`);
  return match[0];
}

function downloadNames(html) {
  return [...html.matchAll(/<a\b[^>]*aria-label="([^"]*)"/g)]
    .map((match) => match[1]).filter((label) => label.startsWith('Download '));
}

test('legacy Mac downloads remain labeled as apps even when their filenames say Screensaver', () => {
  const html = render([macDownload('BTC', 'dmg'), macDownload('BTC', 'zip')]);
  const row = assetRow(html, 'BTC');
  const labels = downloadNames(row);
  assert.equal(labels.length, 2);
  assert.ok(labels.every((label) => label.includes('desktop app')));
  assert.ok(labels.every((label) => !label.includes('native screen saver')));
  assert.match(row, /App · DMG/);
  assert.match(row, /App · Apple Silicon/);
  assert.match(html, /The current Mac downloads contain desktop apps\./);
  assert.doesNotMatch(html, /Mac downloads install a native/);
});

test('native Mac downloads identify the saver package and system installation path', () => {
  const html = render([macDownload('SOL', 'dmg', 'screensaver'), macDownload('SOL', 'zip', 'screensaver')]);
  const row = assetRow(html, 'SOL');
  const labels = downloadNames(row);
  assert.equal(labels.length, 2);
  assert.ok(labels.every((label) => label.includes('native screen saver (.saver)')));
  assert.match(row, /\.saver · DMG/);
  assert.match(row, /\.saver · Apple Silicon/);
  assert.match(html, /Mac downloads install a native \.saver in your system screen saver settings\./);
  assert.doesNotMatch(row, /desktop app|App ·/);
});

test('mixed releases keep app and native saver instructions attached to the correct asset', () => {
  const html = render([
    macDownload('BTC', 'dmg', 'application'), macDownload('BTC', 'zip', 'application'),
    macDownload('SOL', 'dmg', 'screensaver'), macDownload('SOL', 'zip', 'screensaver'),
  ]);
  const bitcoin = assetRow(html, 'BTC');
  const solana = assetRow(html, 'SOL');
  assert.ok(downloadNames(bitcoin).every((label) => label.includes('desktop app')));
  assert.doesNotMatch(bitcoin, /native screen saver|\.saver ·/);
  assert.ok(downloadNames(solana).every((label) => label.includes('native screen saver (.saver)')));
  assert.doesNotMatch(solana, /desktop app|App ·/);
  assert.match(html, /Mac downloads marked \.saver use the system screen saver settings\. Downloads marked App are desktop apps\./);
  for (const symbol of ['BTC', 'SOL']) {
    assert.match(assetRow(html, symbol), new RegExp(`href="[^\"]*/preview/\\?asset=${symbol}"`));
  }
});
