import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const destination = '.cache/desktop-app';
const root = JSON.parse(await readFile('package.json', 'utf8'));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp('dist', `${destination}/dist`, { recursive: true });
await cp('desktop', `${destination}/desktop`, { recursive: true, filter: (file) => !file.endsWith('.test.cjs') });
// Vite already bundles all renderer dependencies. Do not ship the full font/SDK packages.
await writeFile(`${destination}/package.json`, JSON.stringify({
  name: root.name, version: root.version, description: root.description,
  author: root.author, main: root.main, private: true,
}, null, 2));
