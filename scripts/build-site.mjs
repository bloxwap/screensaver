import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateManifest } from './lib/releases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = resolve(root, 'apps/docs');
const output = resolve(docs, 'out');
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/screensaver';
if (basePath !== '' && (!basePath.startsWith('/') || basePath.endsWith('/') || basePath.includes('..'))) {
  throw new Error('NEXT_PUBLIC_BASE_PATH must be empty or a leading-slash path without a trailing slash.');
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath, NEXT_TELEMETRY_DISABLED: '1' },
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const catalog = JSON.parse(await readFile(resolve(root, 'config/assets.json'), 'utf8'));
const release = validateManifest(JSON.parse(await readFile(resolve(root, 'config/releases.json'), 'utf8')));

for (const line of (await readFile(resolve(docs, 'vendor/SHA256SUMS'), 'utf8')).trim().split('\n')) {
  const match = /^([a-f0-9]{64})\s+([A-Za-z0-9._-]+)$/.exec(line.trim());
  if (!match) throw new Error('Invalid docs vendor checksum entry.');
  const bytes = await readFile(resolve(docs, 'vendor', match[2]));
  if (createHash('sha256').update(bytes).digest('hex') !== match[1]) throw new Error(`Docs vendor checksum mismatch: ${match[2]}`);
}

// The website uses the canonical asset icons. The full renderer stays in preview/.
for (const asset of catalog) {
  if (!/^brand\/[A-Z0-9]+\.svg$/.test(asset.icon)) throw new Error(`Invalid asset icon path: ${asset.icon}`);
  const destination = resolve(docs, 'public', asset.icon);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, 'public', asset.icon), destination);
}
await cp(resolve(root, 'public/icon-512.png'), resolve(docs, 'public/icon-512.png'));
await mkdir(resolve(docs, 'public'), { recursive: true });
await writeFile(resolve(docs, 'public/.nojekyll'), '');

run('npm', ['run', 'build']);
run('npm', ['--workspace', '@bloxwap/screensaver-docs', 'run', 'build']);

// Stage after the Next export so it cannot delete or rewrite the Vite application.
await rm(resolve(output, 'preview'), { recursive: true, force: true });
await cp(resolve(root, 'dist'), resolve(output, 'preview'), { recursive: true, dereference: true });
await writeFile(resolve(output, 'releases.json'), `${JSON.stringify(release, null, 2)}\n`);
await writeFile(resolve(output, '_build.json'), `${JSON.stringify({ basePath, version: release.version, releaseTag: release.tag }, null, 2)}\n`);
await writeFile(resolve(output, '.nojekyll'), '');
run(process.execPath, ['scripts/check-site.mjs']);
console.log(`Website ready: apps/docs/out → ${basePath || '/'}/`);
