import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { brandIconSvg, brandXSvg } from '../src/bloxwap/brand.ts';

const icon = brandIconSvg({ size: 512 });
await writeFile('public/icon.svg', icon);
for (const size of [192, 512]) await sharp(Buffer.from(icon)).resize(size, size).png().toFile(`public/icon-${size}.png`);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile('public/apple-touch-icon.png');
const tray = brandXSvg({ color: '#ffffff', size: 32 });
await sharp(Buffer.from(tray)).png().toFile('public/trayTemplate.png');
