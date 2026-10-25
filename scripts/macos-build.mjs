import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactNames, desktopOptions, parseDesktopArgs } from './lib/desktop-config.cjs';

const MINIMUM_SYSTEM_VERSION = '13.0';
const SWIFT_ARCHITECTURES = { arm64: 'arm64', x64: 'x86_64' };

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.code ?? 'unknown'}): ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout ?? '').trim();
}

export function macOSBuildPlan(input = {}) {
  if (input.platform && input.platform !== 'macos') throw new Error('Native screen saver bundles are only built for macos.');
  const options = desktopOptions({ ...input, platform: 'macos' });
  const moduleName = `Bloxwap${options.asset.symbol}Screensaver`;
  const bundle = path.join(options.outputDirectory, `${options.productName}.saver`);
  return {
    ...options,
    kind: 'screensaver',
    moduleName,
    principalClass: `${moduleName}.BloxwapScreenSaverView`,
    minimumSystemVersion: MINIMUM_SYSTEM_VERSION,
    swiftArchitecture: SWIFT_ARCHITECTURES[options.arch],
    bundle,
    binary: path.join(bundle, 'Contents/MacOS', options.identity),
    resources: path.join(bundle, 'Contents/Resources'),
    sourceDirectory: path.join(options.projectRoot, 'native/macos'),
    workDirectory: path.join(options.projectRoot, '.cache/native-macos', `${options.asset.slug}-${options.arch}`),
  };
}

export function bundleMetadata(plan) {
  return {
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundlePackageType: 'BNDL',
    CFBundleIdentifier: plan.appId,
    CFBundleName: plan.productName,
    CFBundleDisplayName: plan.productName,
    CFBundleExecutable: plan.identity,
    CFBundleShortVersionString: plan.version.split('-')[0],
    CFBundleVersion: plan.version.split('-')[0],
    NSPrincipalClass: plan.principalClass,
    LSMinimumSystemVersion: MINIMUM_SYSTEM_VERSION,
    NSHighResolutionCapable: true,
    BloxwapAssetSymbol: plan.asset.symbol,
    BloxwapAssetName: plan.asset.name,
    BloxwapAssetSlug: plan.asset.slug,
    BloxwapReleaseVersion: plan.version,
  };
}

function escapeXML(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function metadataPlist(metadata) {
  const entries = Object.entries(metadata).map(([key, value]) => `  <key>${escapeXML(key)}</key>\n  ${typeof value === 'boolean' ? `<${value ? 'true' : 'false'}/>` : `<string>${escapeXML(value)}</string>`}`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${entries}\n</dict>\n</plist>\n`;
}

export function swiftArguments(plan, sdk, sources) {
  return [
    'swiftc', '-emit-library', '-parse-as-library', '-swift-version', '5', '-O', '-whole-module-optimization',
    '-module-name', plan.moduleName,
    '-sdk', sdk,
    '-target', `${plan.swiftArchitecture}-apple-macosx${MINIMUM_SYSTEM_VERSION}`,
    '-module-cache-path', path.join(plan.workDirectory, 'module-cache'),
    '-framework', 'ScreenSaver', '-framework', 'AppKit', '-framework', 'WebKit',
    // swiftc normally emits a dylib; the screen saver engine loads MH_BUNDLE plugins.
    '-Xlinker', '-bundle',
    ...sources,
    '-o', plan.binary,
  ];
}

async function bundleFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Native screen saver contains an unexpected symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...await bundleFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/** Validate the actual compiled plugin, not just the requested build arguments. */
export async function verifyMacOSBundle(plan, run = execute) {
  const metadata = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(plan.bundle, 'Contents/Info.plist')]));
  for (const [key, expected] of Object.entries(bundleMetadata(plan))) {
    if (metadata[key] !== expected) throw new Error(`Native bundle ${key} does not match the requested edition.`);
  }
  const edition = JSON.parse(await readFile(path.join(plan.resources, 'edition.json'), 'utf8'));
  if (['symbol', 'name', 'slug'].some((key) => edition[key] !== plan.asset[key])) throw new Error('Native bundle edition metadata does not match its asset.');
  const architecture = run('xcrun', ['lipo', '-archs', plan.binary]);
  if (architecture !== plan.swiftArchitecture) throw new Error(`Native bundle architecture is ${architecture}; expected ${plan.swiftArchitecture}.`);
  if (!/\bBUNDLE\b/.test(run('xcrun', ['otool', '-hv', plan.binary]))) throw new Error('Native screen saver executable must be a Mach-O bundle.');
  const files = new Set(await bundleFiles(plan.bundle));
  const required = [
    `Contents/MacOS/${plan.identity}`, 'Contents/Info.plist', 'Contents/Resources/edition.json',
    'Contents/Resources/dist/index.html', 'Contents/Resources/dist/third-party-notices.txt',
    `Contents/Resources/dist/brand/${plan.asset.symbol}.svg`,
    'Contents/Resources/dist/brand/BloxwapSans-Variable.woff2',
    'Contents/Resources/dist/brand/BloxwapMono-Variable.woff2',
  ];
  for (const file of required) if (!files.has(file)) throw new Error(`Native screen saver is missing ${file}.`);
  if ([...files].some((file) => /(?:^|\/)(?:node_modules|desktop|apps)(?:\/|$)/.test(file) || /\.app\//.test(file) || file.endsWith('.asar'))) {
    throw new Error('Native screen savers must not contain Electron applications, desktop host code, or workspace dependencies.');
  }
  const html = await readFile(path.join(plan.resources, 'dist/index.html'), 'utf8');
  for (const [, href] of html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    if (!files.has(`Contents/Resources/dist/${href.slice(2)}`)) throw new Error(`Native renderer references a missing file: ${href}`);
  }
  if (![...files].some((file) => /^Contents\/Resources\/dist\/assets\/.+\.js$/.test(file))) throw new Error('Native screen saver is missing renderer JavaScript.');
  return { kind: 'screensaver', asset: plan.asset.symbol, version: plan.version, arch: plan.arch, principalClass: plan.principalClass, bundle: plan.bundle };
}

/** Renderer build is shared with the other platforms and runs in desktop-build.mjs. */
export async function buildMacOS(input = {}) {
  if (process.platform !== 'darwin') throw new Error('Native .saver bundles require a macOS build host with Xcode command-line tools.');
  const plan = macOSBuildPlan(input);
  const renderer = path.join(plan.projectRoot, 'dist');
  if (!(await stat(path.join(renderer, 'index.html')).catch(() => null))?.isFile()) throw new Error('Missing dist/index.html. Run npm run build or omit --skip-build.');
  const sources = (await readdir(plan.sourceDirectory)).filter((file) => file.endsWith('.swift')).sort().map((file) => path.join(plan.sourceDirectory, file));
  if (sources.length === 0) throw new Error('No native screen saver Swift sources found.');
  const sdk = execute('xcrun', ['--show-sdk-path']);
  // Each asset/architecture owns this output; remove old Electron bundles and
  // prior-version archives so a native release cannot accidentally include them.
  await rm(plan.outputDirectory, { recursive: true, force: true });
  await rm(plan.workDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(plan.binary), { recursive: true });
  await mkdir(plan.resources, { recursive: true });
  await mkdir(plan.workDirectory, { recursive: true });
  await cp(renderer, path.join(plan.resources, 'dist'), { recursive: true });
  await writeFile(path.join(plan.resources, 'edition.json'), `${JSON.stringify({ symbol: plan.asset.symbol, name: plan.asset.name, slug: plan.asset.slug }, null, 2)}\n`);
  await writeFile(path.join(plan.bundle, 'Contents/Info.plist'), metadataPlist(bundleMetadata(plan)));
  await writeFile(path.join(plan.bundle, 'Contents/PkgInfo'), 'BNDL????');
  execute('xcrun', swiftArguments(plan, sdk, sources), { cwd: plan.projectRoot, stdio: 'inherit' });
  await chmod(plan.binary, 0o755);
  const verified = await verifyMacOSBundle(plan);
  const packageArtifacts = input.dir ? undefined : async () => {
    const archiveDirectory = path.join(plan.workDirectory, 'archive');
    await mkdir(archiveDirectory, { recursive: true });
    await cp(plan.bundle, path.join(archiveDirectory, path.basename(plan.bundle)), { recursive: true });
    const [dmg, zip] = artifactNames(plan).map((filename) => path.join(plan.outputDirectory, filename));
    execute('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', plan.bundle, zip]);
    execute('hdiutil', ['create', '-volname', plan.productName, '-srcfolder', archiveDirectory, '-format', 'UDZO', '-ov', dmg]);
    execute('hdiutil', ['verify', dmg]);
    execute('unzip', ['-tq', zip]);
    return [dmg, zip];
  };
  const { signMacOSBundle } = await import('./sign-macos-bundle.mjs');
  const signing = await signMacOSBundle({ bundle: plan.bundle, channel: plan.channel, packageArtifacts });
  await writeFile(path.join(plan.outputDirectory, 'native-build.json'), `${JSON.stringify({ ...verified, channel: plan.channel, signed: signing.signed, notarized: signing.notarized }, null, 2)}\n`);
  console.log(`Built native ${plan.productName} for macos/${plan.arch}: ${plan.bundle}`);
  return { ...verified, files: signing.files ?? [], signed: signing.signed, notarized: signing.notarized };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const input = parseDesktopArgs(args);
    if (input.platform && input.platform !== 'macos') throw new Error('macos-build.mjs only builds native Mac screen savers.');
    const { buildDesktop } = await import('./desktop-build.mjs');
    await buildDesktop(input.platform ? args : [...args, '--platform', 'macos']);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
