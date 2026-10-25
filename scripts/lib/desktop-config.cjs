const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PLATFORM_NAMES = Object.freeze({ darwin: 'macos', win32: 'windows', linux: 'linux' });
const SUPPORTED_ARCHITECTURES = Object.freeze({ macos: ['arm64', 'x64'], windows: ['x64'], linux: ['x64'] });
const FORMATS = Object.freeze({ macos: ['dmg', 'zip'], windows: ['exe'], linux: ['AppImage', 'deb'] });

function nativePlatform(platform = process.platform) {
  const value = PLATFORM_NAMES[platform];
  if (!value) throw new Error(`Unsupported desktop build host: ${platform}`);
  return value;
}

function desktopOptions(input = {}, environment = process.env) {
  const projectRoot = path.resolve(input.projectRoot ?? PROJECT_ROOT);
  const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config/assets.json'), 'utf8'));
  const symbol = String(typeof input.asset === 'object' ? input.asset.symbol : input.asset ?? environment.SCREENSAVER_ASSET ?? 'BTC').toUpperCase();
  const asset = catalog.find((item) => item.symbol === symbol);
  if (!asset || !/^[a-z][a-z0-9-]*$/.test(asset.slug)) {
    throw new Error(`Unknown screensaver asset ${symbol}. Choose ${catalog.map((item) => item.symbol).join(', ')}.`);
  }
  const platform = input.platform ?? environment.SCREENSAVER_PLATFORM ?? nativePlatform();
  const arch = input.arch ?? environment.SCREENSAVER_ARCH ?? process.arch;
  if (!SUPPORTED_ARCHITECTURES[platform]?.includes(arch)) {
    throw new Error(`Unsupported desktop target ${platform}/${arch}. Supported: macos/arm64, macos/x64, windows/x64, linux/x64.`);
  }
  const version = metadata.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
    throw new Error('package.json must contain a valid release version.');
  }
  const electronVersion = metadata.devDependencies?.electron;
  if (typeof electronVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(electronVersion)) {
    throw new Error('Pin the Electron devDependency to an exact version before packaging.');
  }
  const identity = `bloxwap-screensaver-${asset.slug}`;
  const target = `${asset.slug}-${platform}-${arch}`;
  const channel = input.channel ?? environment.SCREENSAVER_RELEASE_CHANNEL ?? 'preview';
  if (!['preview', 'stable'].includes(channel)) throw new Error(`Unsupported desktop release channel: ${channel}`);
  return {
    projectRoot, metadata, asset, platform, arch, version, electronVersion, identity, channel,
    appId: `com.bloxwap.screensaver.${asset.slug}`,
    productName: `Bloxwap ${asset.name} Screensaver`,
    stageDirectory: path.join(projectRoot, '.cache/desktop-app', target),
    outputDirectory: path.join(projectRoot, 'release', target),
    artifactPrefix: `${identity}-${version}-${platform}-${arch}`,
  };
}

function desktopConfig(input = {}, environment = process.env) {
  const options = desktopOptions(input, environment);
  const artifactName = `${options.artifactPrefix}.\${ext}`;
  const target = (name) => ({ target: name, arch: [options.arch] });
  const stable = options.channel === 'stable';
  return {
    appId: options.appId,
    productName: options.productName,
    electronVersion: options.electronVersion,
    directories: { app: options.stageDirectory, output: options.outputDirectory, buildResources: path.join(options.projectRoot, 'public') },
    files: ['dist/**/*', 'desktop/**/*.cjs', '!desktop/**/*.test.cjs', 'desktop/edition.json', 'package.json'],
    extraMetadata: { name: options.identity, productName: options.productName, screensaverAsset: options.asset.symbol },
    asar: true,
    afterPack: path.join(options.projectRoot, 'scripts/verify-desktop.cjs'),
    npmRebuild: false,
    publish: null,
    artifactName,
    mac: { target: [target('dmg'), target('zip')], category: 'public.app-category.finance', minimumSystemVersion: '13.0', icon: path.join(options.projectRoot, 'public/icon-512.png'), artifactName, hardenedRuntime: stable, entitlements: path.join(options.projectRoot, 'scripts/entitlements.mac.plist'), entitlementsInherit: path.join(options.projectRoot, 'scripts/entitlements.mac.plist'), notarize: stable, forceCodeSigning: stable, ...(stable ? {} : { identity: '-' }) },
    win: { target: [target('nsis')], executableName: options.identity, icon: path.join(options.projectRoot, 'public/icon-512.png'), artifactName, forceCodeSigning: stable, ...(stable ? { signtoolOptions: { signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: 'http://timestamp.digicert.com' } } : {}) },
    linux: { target: [target('AppImage'), target('deb')], executableName: options.identity, category: 'Utility', icon: path.join(options.projectRoot, 'public/icon-512.png'), maintainer: 'Bloxwap <support@bloxwap.com>', artifactName },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false, deleteAppDataOnUninstall: false, uninstallDisplayName: options.productName, artifactName },
  };
}

function artifactNames(options) {
  return FORMATS[options.platform].map((format) => `${options.artifactPrefix}.${format}`);
}

function parseDesktopArgs(args) {
  const result = {};
  const values = new Map([['--asset', 'asset'], ['--arch', 'arch'], ['--platform', 'platform'], ['--channel', 'channel']]);
  const flags = new Map([['--dir', 'dir'], ['--skip-build', 'skipBuild'], ['--dry-run', 'dryRun'], ['--help', 'help']]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (flags.has(argument)) { result[flags.get(argument)] = true; continue; }
    const separator = argument.indexOf('=');
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const key = values.get(flag);
    if (!key) throw new Error(`Unknown desktop build option: ${argument}`);
    const value = separator === -1 ? args[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (key in result) throw new Error(`Duplicate desktop build option: ${flag}`);
    result[key] = value;
  }
  return result;
}

module.exports = { PROJECT_ROOT, SUPPORTED_ARCHITECTURES, FORMATS, nativePlatform, desktopOptions, desktopConfig, artifactNames, parseDesktopArgs };
