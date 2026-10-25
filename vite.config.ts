import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import assets from './config/assets.json' with { type: 'json' };

const manifest: Partial<ManifestOptions> = {
  name: 'Bloxwap Screensaver',
  short_name: 'Screensaver',
  description: 'Bitcoin, Solana, Ethereum, and Hyperliquid. Live market prices by Bloxwap.',
  // Omitting id lets the fully resolved start_url identify the app. A relative
  // manifest id resolves against the origin, not the preview's directory.
  start_url: './',
  scope: './',
  display: 'standalone',
  display_override: ['fullscreen', 'standalone'],
  background_color: '#0a0a0a',
  theme_color: '#0a0a0a',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};

function editionManifests(): Plugin {
  const editions = new Map(assets.map((asset) => [
    `manifest-${asset.symbol.toLowerCase()}.webmanifest`,
    JSON.stringify({ ...manifest, name: `${asset.name} · Bloxwap Screensaver`, short_name: asset.name,
      description: `${asset.name}, in motion. Live market prices by Bloxwap.`, start_url: `./?asset=${asset.symbol}` }),
  ]));
  return {
    name: 'screensaver-edition-manifests',
    generateBundle() {
      for (const [fileName, source] of editions) this.emitFile({ type: 'asset', fileName, source });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = editions.get((request.url ?? '').split('?')[0].replace(/^\//, ''));
        if (!source) return next();
        response.setHeader('Content-Type', 'application/manifest+json');
        response.end(source);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'development-csp',
      apply: 'serve',
      // Vite's development refresh preamble needs inline script execution.
      // The packaged app retains the strict policy from index.html.
      transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    },
    react(),
    editionManifests(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      scope: './',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf,wasm,txt,webmanifest}'],
        // Only the application shell is cached. Prices always come from Hyperliquid.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
