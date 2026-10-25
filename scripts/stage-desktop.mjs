import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktopOptions, parseDesktopArgs } from './lib/desktop-config.cjs';

/** Each edition/OS/architecture owns its staging directory, so matrix jobs cannot mix assets. */
export async function stageDesktop(input = {}) {
  const options = desktopOptions(input);
  if (options.platform === 'macos') throw new Error('Mac distribution uses a native .saver bundle; use desktop-build.mjs instead of Electron staging.');
  const source = path.join(options.projectRoot, 'dist');
  if (!(await stat(path.join(source, 'index.html')).catch(() => null))?.isFile()) {
    throw new Error('Missing dist/index.html. Run npm run build before staging the desktop app.');
  }
  const destination = options.stageDirectory;
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, path.join(destination, 'dist'), { recursive: true });
  await cp(path.join(options.projectRoot, 'desktop'), path.join(destination, 'desktop'), {
    recursive: true,
    filter: (file) => !file.endsWith('.test.cjs') && !file.endsWith('edition.json'),
  });
  const edition = { symbol: options.asset.symbol, name: options.asset.name, slug: options.asset.slug };
  await writeFile(path.join(destination, 'desktop/edition.json'), `${JSON.stringify(edition, null, 2)}\n`);
  // Vite bundles renderer dependencies. A tiny package manifest prevents Electron
  // Builder from shipping workspace, font, SDK, test, or documentation packages.
  const manifest = {
    name: options.identity,
    version: options.version,
    description: `A live ${options.asset.name} screensaver, powered by Bloxwap and Hyperliquid.`,
    productName: options.productName,
    screensaverAsset: options.asset.symbol,
    author: { name: 'Bloxwap', email: 'support@bloxwap.com' },
    homepage: 'https://bloxwap.github.io/screensaver/',
    repository: options.metadata.repository,
    main: 'desktop/main.cjs',
    private: true,
  };
  await writeFile(path.join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Reject incomplete renderer output before handing this edition to the packager.
  await readFile(path.join(destination, manifest.main));
  await readFile(path.join(destination, 'dist/third-party-notices.txt'));
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = await stageDesktop(parseDesktopArgs(process.argv.slice(2)));
    console.log(`Staged ${options.productName} for ${options.platform}/${options.arch}: ${options.stageDirectory}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
