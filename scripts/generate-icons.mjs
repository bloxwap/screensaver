import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const mark = '<g fill="none" stroke="#00ff3f" stroke-width="13" stroke-linecap="round"><path d="M29 71 71 29M29 29 38 38M62 62 71 71"/></g>';
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100"><rect width="100" height="100" fill="#101010"/>${mark}</svg>`;
await mkdir('public', { recursive: true });
await writeFile('public/icon.svg', icon);
for (const size of [192, 512]) await sharp(Buffer.from(icon)).resize(size, size).png().toFile(`public/icon-${size}.png`);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile('public/apple-touch-icon.png');
const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 100 100">${mark.replace('#00ff3f', '#ffffff')}</svg>`;
await sharp(Buffer.from(tray)).png().toFile('public/trayTemplate.png');
