import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Keep public builds independent of the sibling monorepo. Refresh only this explicit
// set of shared design assets; no application configuration or credentials are copied.
const source = resolve(process.argv[2] ?? '../monorepo');
const files = [
  ['packages/markets/svg/BTC.svg', 'public/brand/BTC.svg'],
  ['packages/tokens/src/brand.ts', 'src/bloxwap/brand.ts'],
  ['packages/trading-core/src/chart-math.ts', 'src/bloxwap/chart-math.ts'],
  ['packages/ui/src/components/brand-wordmark.tsx', 'src/bloxwap/BrandWordmark.tsx', (text) => text.replace('@workspace/tokens/brand', './brand')],
  ['packages/ui/src/styles/tokens.generated.css', 'src/bloxwap/tokens.css', (text) => text.replace(/@theme(?: inline)?\s*\{[^}]*\}/g, '').trimEnd() + '\n'],
  ['node_modules/@bloxwap/font/fonts/BloxwapSans/BloxwapSans-Variable.woff2', 'public/brand/BloxwapSans-Variable.woff2'],
  ['node_modules/@bloxwap/font/fonts/BloxwapMono/BloxwapMono-Variable.woff2', 'public/brand/BloxwapMono-Variable.woff2'],
  ['packages/tokens/assets/fonts/Bloxwap-OFL.txt', 'public/brand/Bloxwap-OFL.txt'],
  ['apps/app/public/fonts/SpaceGrotesk-Bold.ttf', 'public/brand/SpaceGrotesk-Bold.ttf'],
  ['apps/app/public/fonts/OFL.txt', 'public/brand/SpaceGrotesk-OFL.txt', (text) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '')],
];
const manifest = {
  repository: 'bloxwap/monorepo',
  commit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  fontVersion: JSON.parse(await readFile(resolve(source, 'node_modules/@bloxwap/font/package.json'), 'utf8')).version,
  files: [],
};
for (const [from, to, transform] of files) {
  const original = await readFile(resolve(source, from));
  const output = transform ? Buffer.from(transform(original.toString('utf8'))) : original;
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, output);
  manifest.files.push({ source: from, destination: to, sourceSha256: createHash('sha256').update(original).digest('hex'), sha256: createHash('sha256').update(output).digest('hex') });
}
await writeFile('src/bloxwap/provenance.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synced ${files.length} Bloxwap assets from ${manifest.commit.slice(0, 7)}.`);
