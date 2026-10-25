import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { artifactNames, desktopConfig, desktopOptions, parseDesktopArgs, SUPPORTED_ARCHITECTURES } from './lib/desktop-config.cjs';
import { stageDesktop } from './stage-desktop.mjs';

const require = createRequire(import.meta.url);
const { verifyDesktopArchive } = require('./verify-desktop.cjs');
const asar = createRequire(require.resolve('app-builder-lib'))('@electron/asar');

const catalog = JSON.parse(await readFile(new URL('../config/assets.json', import.meta.url), 'utf8'));

test('every supported edition/architecture has a unique artifact, application identity, and staging directory', () => {
  const artifacts = new Set();
  const stages = new Set();
  const appIds = new Set();
  for (const asset of catalog) {
    for (const [platform, architectures] of Object.entries(SUPPORTED_ARCHITECTURES)) {
      for (const arch of architectures) {
        const options = desktopOptions({ asset: asset.symbol, platform, arch }, {});
        const config = desktopConfig(options, {});
        assert.equal(config.extraMetadata.screensaverAsset, asset.symbol);
        assert.equal(config.appId, `com.bloxwap.screensaver.${asset.slug}`);
        assert.equal(config.productName, `Bloxwap ${asset.name} Screensaver`);
        assert.equal(config.directories.app, options.stageDirectory);
        assert.ok(config.files.includes('desktop/edition.json'));
        assert.ok(!stages.has(options.stageDirectory));
        stages.add(options.stageDirectory);
        appIds.add(options.appId);
        for (const filename of artifactNames(options)) {
          assert.ok(filename.startsWith(`bloxwap-screensaver-${asset.slug}-${options.version}-${platform}-${arch}.`));
          assert.ok(!artifacts.has(filename), `Collision: ${filename}`);
          artifacts.add(filename);
        }
      }
    }
  }
  assert.equal(stages.size, 16);
  assert.equal(artifacts.size, 28);
  assert.equal(appIds.size, 4);
});

test('unsupported targets and malformed options fail instead of silently building Bitcoin or another architecture', () => {
  assert.throws(() => desktopOptions({ asset: 'DOGE', platform: 'macos', arch: 'arm64' }, {}), /Unknown screensaver asset/);
  assert.throws(() => desktopOptions({ asset: '../../btc', platform: 'macos', arch: 'arm64' }, {}), /Unknown screensaver asset/);
  assert.throws(() => desktopOptions({ asset: 'BTC', platform: 'windows', arch: 'arm64' }, {}), /Unsupported desktop target/);
  assert.throws(() => desktopOptions({ asset: 'BTC', platform: 'linux', arch: 'ia32' }, {}), /Unsupported desktop target/);
  assert.throws(() => parseDesktopArgs(['--asset']), /Missing value/);
  assert.throws(() => parseDesktopArgs(['--asset', '--arch', 'x64']), /Missing value/);
  assert.throws(() => parseDesktopArgs(['--asset', 'BTC', '--asset', 'SOL']), /Duplicate/);
  assert.throws(() => parseDesktopArgs(['--publish', 'always']), /Unknown/);
  assert.deepEqual(parseDesktopArgs(['--asset=SOL', '--arch', 'x64', '--dir', '--skip-build']), { asset: 'SOL', arch: 'x64', dir: true, skipBuild: true });
});

test('preview and stable configuration have explicit signing/notarization policies', () => {
  const input = { asset: 'BTC', platform: 'macos', arch: 'arm64' };
  const preview = desktopConfig({ ...input, channel: 'preview' }, {});
  assert.equal(preview.mac.identity, '-');
  assert.equal(preview.mac.hardenedRuntime, false);
  assert.equal(preview.mac.notarize, false);
  assert.equal(preview.mac.forceCodeSigning, false);
  assert.equal(preview.win.forceCodeSigning, false);
  const stable = desktopConfig({ ...input, channel: 'stable' }, {});
  assert.equal(stable.mac.forceCodeSigning, true);
  assert.equal(stable.mac.notarize, true);
  assert.equal(stable.mac.hardenedRuntime, true);
  assert.equal(stable.win.forceCodeSigning, true);
  assert.deepEqual(stable.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bloxwap-desktop-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['config', 'dist', 'desktop', 'apps/docs', 'node_modules']) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3', repository: 'https://github.com/bloxwap/screensaver', devDependencies: { electron: '45.0.0', forbidden: '1.0.0' }, dependencies: { forbidden: '1.0.0' } }));
  await writeFile(path.join(root, 'config/assets.json'), JSON.stringify(catalog));
  await writeFile(path.join(root, 'dist/index.html'), '<!doctype html><title>Shared renderer</title>');
  await writeFile(path.join(root, 'dist/third-party-notices.txt'), 'Bundled dependency notices');
  await writeFile(path.join(root, 'desktop/main.cjs'), 'require("electron");');
  await writeFile(path.join(root, 'desktop/idle.test.cjs'), 'throw new Error("must not ship");');
  await writeFile(path.join(root, 'desktop/edition.json'), '{"symbol":"WRONG"}');
  await writeFile(path.join(root, 'apps/docs/index.html'), 'must not ship');
  await writeFile(path.join(root, 'node_modules/forbidden'), 'must not ship');
  return root;
}

test('staging writes immutable edition metadata without dependencies/docs and does not erase another edition', async (t) => {
  const projectRoot = await fixture(t);
  const bitcoin = await stageDesktop({ projectRoot, asset: 'BTC', platform: 'macos', arch: 'arm64' });
  const solana = await stageDesktop({ projectRoot, asset: 'SOL', platform: 'windows', arch: 'x64' });
  const [btc, sol] = await Promise.all([bitcoin, solana].map(async (options) => ({
    edition: JSON.parse(await readFile(path.join(options.stageDirectory, 'desktop/edition.json'), 'utf8')),
    package: JSON.parse(await readFile(path.join(options.stageDirectory, 'package.json'), 'utf8')),
    rootFiles: await readdir(options.stageDirectory),
    desktopFiles: await readdir(path.join(options.stageDirectory, 'desktop')),
  })));
  assert.deepEqual(btc.edition, { symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin' });
  assert.deepEqual(sol.edition, { symbol: 'SOL', name: 'Solana', slug: 'solana' });
  for (const staged of [btc, sol]) {
    assert.deepEqual(staged.rootFiles.sort(), ['desktop', 'dist', 'package.json']);
    assert.ok(!staged.desktopFiles.some((name) => name.endsWith('.test.cjs')));
    assert.equal(staged.package.dependencies, undefined);
    assert.equal(staged.package.devDependencies, undefined);
    assert.equal(staged.package.workspaces, undefined);
    assert.equal(staged.package.version, '1.2.3');
    assert.equal(staged.package.screensaverAsset, staged.edition.symbol);
  }
  // Rebuilding one edition must remove its stale staged files while preserving the other.
  await writeFile(path.join(bitcoin.stageDirectory, 'stale-file'), 'old');
  await stageDesktop({ projectRoot, asset: 'BTC', platform: 'macos', arch: 'arm64' });
  assert.ok(!(await readdir(bitcoin.stageDirectory)).includes('stale-file'));
  assert.equal(JSON.parse(await readFile(path.join(solana.stageDirectory, 'desktop/edition.json'), 'utf8')).symbol, 'SOL');
});

test('staging refuses a missing renderer instead of packaging an empty app', async (t) => {
  const projectRoot = await fixture(t);
  await rm(path.join(projectRoot, 'dist/index.html'));
  await assert.rejects(stageDesktop({ projectRoot, asset: 'ETH', platform: 'linux', arch: 'x64' }), /Missing dist\/index.html/);
});

test('post-pack verification inspects real archive contents and rejects wrong editions or missing renderer files', async (t) => {
  const projectRoot = await fixture(t);
  await mkdir(path.join(projectRoot, 'dist/brand'), { recursive: true });
  await mkdir(path.join(projectRoot, 'dist/assets'), { recursive: true });
  await writeFile(path.join(projectRoot, 'dist/index.html'), '<!doctype html><script src="./assets/index.js"></script>');
  for (const name of ['preload.cjs', 'edition.cjs', 'idle.cjs']) await writeFile(path.join(projectRoot, 'desktop', name), '// fixture');
  for (const name of ['trayTemplate.png', 'brand/ETH.svg', 'brand/BloxwapSans-Variable.woff2', 'brand/BloxwapMono-Variable.woff2', 'assets/index.js']) await writeFile(path.join(projectRoot, 'dist', name), 'fixture');
  const options = await stageDesktop({ projectRoot, asset: 'ETH', platform: 'linux', arch: 'x64' });
  const archive = path.join(projectRoot, 'app.asar');
  await asar.createPackage(options.stageDirectory, archive);
  assert.equal(verifyDesktopArchive(archive, options).asset, 'ETH');

  const editionFile = path.join(options.stageDirectory, 'desktop/edition.json');
  const original = await readFile(editionFile);
  await writeFile(editionFile, JSON.stringify({ symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin' }));
  await asar.createPackage(options.stageDirectory, archive);
  assert.throws(() => verifyDesktopArchive(archive, options), /edition metadata does not match/);

  await writeFile(editionFile, original);
  await rm(path.join(options.stageDirectory, 'dist/assets/index.js'));
  await asar.createPackage(options.stageDirectory, archive);
  assert.throws(() => verifyDesktopArchive(archive, options), /references a missing file/);
});
