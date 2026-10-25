import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { getAsset } from './assets';
import './styles.css';

// Each edition gets its own launch URL. Manifest URLs stay relative to the preview
// directory, so installing a preview cannot capture the docs or another project.
function updateManifest() {
  const asset = getAsset(new URLSearchParams(location.search).get('asset'));
  let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.append(manifest);
  }
  manifest.href = `${import.meta.env.BASE_URL}manifest-${asset.symbol.toLowerCase()}.webmanifest`;
}
if (window.nativeScreensaver) {
  // The ScreenSaverView owns installation and execution. Its bundled custom-
  // scheme document must never become an installed web app or register a worker.
  document.querySelectorAll('link[rel="manifest"]').forEach((manifest) => manifest.remove());
} else {
  updateManifest();
  window.addEventListener('popstate', updateManifest);
}

createRoot(document.getElementById('root')!).render(<App />);

// Electron loads packaged assets from file://; the installed desktop app has no service worker.
if (!window.nativeScreensaver && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  registerSW({ immediate: true });
}
