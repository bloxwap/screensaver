import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundleMetadata, macOSBuildPlan, metadataPlist, swiftArguments } from './macos-build.mjs';

const catalog = JSON.parse(await readFile(new URL('../config/assets.json', import.meta.url), 'utf8'));

test('all Mac editions use distinct plugin classes and bundles while preserving public artifact identities', () => {
  const principalClasses = new Set();
  const bundles = new Set();
  for (const asset of catalog) {
    for (const arch of ['arm64', 'x64']) {
      const plan = macOSBuildPlan({ asset: asset.symbol, arch });
      assert.equal(plan.kind, 'screensaver');
      assert.equal(plan.moduleName, `Bloxwap${asset.symbol}Screensaver`);
      assert.equal(plan.principalClass, `${plan.moduleName}.BloxwapScreenSaverView`);
      assert.ok(plan.bundle.endsWith(`/${asset.slug}-macos-${arch}/Bloxwap ${asset.name} Screensaver.saver`.replaceAll('/', path.sep)));
      assert.equal(bundleMetadata(plan).NSPrincipalClass, plan.principalClass);
      assert.equal(bundleMetadata(plan).BloxwapAssetSymbol, asset.symbol);
      assert.equal(bundleMetadata(plan).CFBundlePackageType, 'BNDL');
      assert.equal(bundleMetadata(plan).LSMinimumSystemVersion, '13.0');
      assert.equal(bundleMetadata(plan).CFBundleExecutable, `bloxwap-screensaver-${asset.slug}`);
      principalClasses.add(plan.principalClass);
      assert.ok(!bundles.has(plan.bundle));
      bundles.add(plan.bundle);
    }
  }
  assert.equal(principalClasses.size, 4);
  assert.equal(bundles.size, 8);
});

test('Swift compile plan produces a Mach-O bundle for the exact public architecture and edition module', () => {
  for (const [arch, target] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
    const plan = macOSBuildPlan({ asset: 'SOL', arch });
    const args = swiftArguments(plan, '/SDK/MacOSX.sdk', ['/source/ScreenSaverView.swift']);
    const following = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(following('-target'), `${target}-apple-macosx13.0`);
    assert.equal(following('-module-name'), 'BloxwapSOLScreensaver');
    assert.equal(following('-sdk'), '/SDK/MacOSX.sdk');
    assert.equal(following('-Xlinker'), '-bundle');
    assert.equal(following('-o'), plan.binary);
    for (const framework of ['ScreenSaver', 'AppKit', 'WebKit']) assert.ok(args.includes(framework));
    assert.ok(!args.some((argument) => argument.includes('Electron')));
  }
  assert.throws(() => macOSBuildPlan({ platform: 'windows', arch: 'x64' }), /only built for macos/);
  assert.throws(() => macOSBuildPlan({ asset: 'BTC', arch: 'ia32' }), /Unsupported desktop target/);
});

test('native Mac metadata is independent of Electron and XML-escapes bundle strings', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'bloxwap-native-config-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, 'config'));
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ version: '0.2.0-preview.1' }));
  await writeFile(path.join(projectRoot, 'config/assets.json'), JSON.stringify(catalog));
  const plan = macOSBuildPlan({ projectRoot, asset: 'HYPE', arch: 'arm64' });
  const metadata = bundleMetadata(plan);
  assert.equal(metadata.BloxwapReleaseVersion, '0.2.0-preview.1');
  assert.equal(metadata.CFBundleShortVersionString, '0.2.0');
  assert.equal(metadata.CFBundleVersion, '0.2.0');
  assert.equal(plan.electronVersion, undefined);
  const plist = metadataPlist({ ...metadata, Example: 'A & B <C> "D"', Boolean: true });
  assert.match(plist, /A &amp; B &lt;C&gt; &quot;D&quot;/);
  assert.match(plist, /<true\/>/);
  assert.match(plist, /<string>BNDL<\/string>/);
});
