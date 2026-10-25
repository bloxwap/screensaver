import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  asset: { type: 'string', default: 'all' },
  arch: { type: 'string', default: process.arch },
  directory: { type: 'string' },
  bundle: { type: 'string' },
  output: { type: 'string' },
  timeout: { type: 'string', default: '180' },
  'sustain-seconds': { type: 'string', default: '12' },
  'require-live': { type: 'boolean', default: false },
} });

function run(command, args, timeout) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', timeout, killSignal: 'SIGKILL' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? done() : reject(new Error(`${command} exited ${code ?? signal}`)));
  });
}

try {
  if (process.platform !== 'darwin') throw new Error('Native .saver runtime smoke requires macOS.');
  if (!['arm64', 'x64'].includes(values.arch) || values.arch !== process.arch) {
    throw new Error(`Run ${values.arch} runtime checks on a native ${values.arch} Mac runner (this process is ${process.arch}).`);
  }
  if (values.bundle && values.directory) throw new Error('Use --bundle or --directory, not both.');
  const timeoutSeconds = Number(values.timeout);
  const sustainSeconds = Number(values['sustain-seconds']);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 600) throw new Error('--timeout must be between 30 and 600 seconds.');
  if (!Number.isFinite(sustainSeconds) || sustainSeconds < 10 || sustainSeconds > 60) throw new Error('--sustain-seconds must be between 10 and 60 seconds.');
  const catalog = JSON.parse(await readFile(join(root, 'config/assets.json'), 'utf8'));
  let symbols = values.asset.toUpperCase() === 'ALL' ? catalog.map((asset) => asset.symbol) : values.asset.toUpperCase().split(',');
  if (values.bundle && values.asset === 'all') {
    const edition = JSON.parse(await readFile(join(resolve(values.bundle), 'Contents/Resources/edition.json'), 'utf8'));
    symbols = [edition.symbol];
  }
  if ((values.bundle || values.directory) && symbols.length !== 1) throw new Error('A --directory/--bundle checks one edition; supply --asset SYMBOL. Use --asset all without those options to check coexistence.');
  if (new Set(symbols).size !== symbols.length) throw new Error('Each edition must be selected once.');
  const editions = await Promise.all(symbols.map(async (symbol) => {
    const asset = catalog.find((item) => item.symbol === symbol);
    if (!asset) throw new Error(`Unknown asset ${symbol}; choose ${catalog.map((item) => item.symbol).join(', ')} or all.`);
    const directory = values.directory ? resolve(values.directory) : join(root, 'release', `${asset.slug}-macos-${values.arch}`);
    const path = await realpath(values.bundle ? resolve(values.bundle) : join(directory, `Bloxwap ${asset.name} Screensaver.saver`));
    if (!path.endsWith('.saver')) throw new Error('Smoke target must be a .saver bundle.');
    return { path, symbol: asset.symbol, name: asset.name };
  }));
  const outputDirectory = resolve(values.output ?? join(root, 'test-results', 'native-macos', `${symbols.join('-').toLowerCase()}-${values.arch}`));
  await mkdir(outputDirectory, { recursive: true });
  const cache = join(root, '.cache', 'native-smoke', values.arch);
  await mkdir(cache, { recursive: true });
  const executable = join(cache, 'MacScreenSaverSmoke');
  const target = `${values.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
  await run('xcrun', ['swiftc', '-swift-version', '5', '-target', target,
    '-framework', 'AppKit', '-framework', 'ScreenSaver', '-framework', 'WebKit',
    join(root, 'native/tests/MacScreenSaverSmoke.swift'), '-o', executable], 120_000);
  const planPath = join(cache, `plan-${symbols.join('-').toLowerCase()}.json`);
  await writeFile(planPath, `${JSON.stringify({ editions, requireLive: values['require-live'], sustainSeconds, timeoutSeconds, outputDirectory }, null, 2)}\n`);
  console.log(`Loading ${editions.length} native edition(s) without installing or changing screen saver settings.`);
  await run(executable, [planPath], (timeoutSeconds + 15) * 1_000);
  console.log(`Native runtime evidence: ${join(outputDirectory, 'report.json')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
