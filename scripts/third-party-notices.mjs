import { readFile, writeFile } from 'node:fs/promises';

const packages = ['@bloxwap/chart', '@bloxwap/hyperliquid', '@bloxwap/font', '@number-flow/react', 'number-flow', 'esm-env', 'qrcode.react', 'react', 'react-dom', 'scheduler', 'valibot', 'workbox-core', 'workbox-window', 'workbox-precaching', 'workbox-routing', 'workbox-strategies'];
const sections = ['Third-party software and font notices\nBloxwap Screensaver\n'];
for (const name of packages) {
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch { /* Try the package's next conventional license filename. */ }
  }
  if (!license) throw new Error(`Missing license for bundled dependency ${name}`);
  sections.push(`${name}\n${'-'.repeat(name.length)}\n${license}`);
}
for (const font of ['BloxwapMono', 'BloxwapSans']) {
  sections.push(`${font}\n${await readFile(`node_modules/@bloxwap/font/fonts/${font}/LICENSE`, 'utf8')}`);
}
await writeFile('public/third-party-notices.txt', sections.join('\n\n'));
