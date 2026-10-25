import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checksumText, createManifest } from './lib/releases.mjs';

const { values } = parseArgs({ options: {
  directory: { type: 'string', default: 'release' }, output: { type: 'string', default: 'release-metadata' },
  version: { type: 'string' }, tag: { type: 'string' }, channel: { type: 'string', default: 'preview' },
} });
if (!values.tag) throw new Error('--tag is required');
const version = values.version ?? JSON.parse(await readFile('package.json', 'utf8')).version;
const manifest = await createManifest({ directory: resolve(values.directory), version, tag: values.tag, channel: values.channel });
await mkdir(values.output, { recursive: true });
await writeFile(resolve(values.output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(values.output, 'SHA256SUMS'), checksumText(manifest));
console.log(`Verified ${manifest.downloads.length} ${manifest.channel} installers for ${manifest.tag}.`);
