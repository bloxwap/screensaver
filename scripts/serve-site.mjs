import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'apps/docs/out');
let build;
try { build = JSON.parse(await readFile(resolve(root, '_build.json'), 'utf8')); }
catch { throw new Error('Build the website first with npm run docs:build.'); }
const basePath = build.basePath;
const port = Number(process.env.PORT ?? 3907);
const host = process.env.HOST ?? '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let url;
  let pathname;
  try {
    url = new URL(request.url ?? '/', 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch { response.writeHead(400).end('Bad request'); return; }
  if (basePath && pathname === '/') { response.writeHead(302, { Location: `${basePath}/` }).end(); return; }
  if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) { response.writeHead(404).end('Not found'); return; }
  let file = resolve(root, `.${pathname.slice(basePath.length) || '/'}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) { response.writeHead(404).end('Not found'); return; }
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) { response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end(); return; }
      file = resolve(file, 'index.html');
      info = await stat(file);
    }
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});
server.listen(port, host, () => console.log(`Screensaver website: http://${host}:${port}${basePath}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
