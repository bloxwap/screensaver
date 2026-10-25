import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ASSET, type Asset } from '../assets';

export type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown';

const DOWNLOAD_SITE = 'https://bloxwap.github.io/screensaver/';
const DESKTOP_DOWNLOADS = {
  macos: { name: 'macOS' },
  windows: { name: 'Windows' },
  linux: { name: 'Linux' },
} as const;

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent) || /Win/.test(navigator.platform)) return 'windows';
  if (/Macintosh/i.test(userAgent) || /Mac/.test(navigator.platform)) return 'macos';
  if (/Linux|X11/i.test(userAgent) || /Linux/i.test(navigator.platform)) return 'linux';
  return 'unknown';
}

function InstallIcon({ share = false }: { share?: boolean }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {share ? <><path d="M12 16V3m-4 4 4-4 4 4" /><path d="M7 10H5v11h14V10h-2" /></> : <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 17v3h14v-3" /></>}
  </svg>;
}

export function InstallDialog({ onClose, prompt, onPromptUsed, asset = DEFAULT_ASSET }: { onClose: () => void; prompt: InstallPrompt | null; onPromptUsed: () => void; asset?: Asset }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<{ idleEnabled: boolean; idleMinutes: number } | null>(null);
  const [error, setError] = useState('');
  const desktopApp = Boolean(window.screensaver);
  const platform = detectPlatform();
  const download = platform === 'macos' || platform === 'windows' || platform === 'linux' ? DESKTOP_DOWNLOADS[platform] : null;
  const canShare = platform === 'ios' && typeof navigator.share === 'function';

  useEffect(() => {
    ref.current?.showModal();
    if (window.screensaver) void window.screensaver.getSettings().then(setSettings).catch(() => setError('Could not load desktop preferences.'));
  }, []);

  async function updateSettings(next: { idleEnabled: boolean; idleMinutes: number }) {
    try { setSettings(await window.screensaver!.setSettings(next)); }
    catch { setError('Could not save desktop preferences.'); }
  }

  async function installApp() {
    if (!prompt) return;
    try {
      setError('');
      await prompt.prompt();
      await prompt.userChoice;
      onPromptUsed();
    } catch { setError('Use your browser’s install menu to add the app.'); }
  }

  async function shareApp() {
    if (!navigator.share) return;
    try {
      setError('');
      await navigator.share({ title: `${asset.name} · Bloxwap Screensaver`, url: window.location.href });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError('In Safari, tap Share, then Add to Home Screen.');
    }
  }

  return <dialog ref={ref} className="install-dialog" aria-labelledby="install-title" aria-describedby="install-description" onCancel={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
    <div className="dialog-top"><span className="eyebrow">Bloxwap screensaver</span><button className="icon-button" onClick={onClose} aria-label="Close installation instructions">×</button></div>
    <h2 id="install-title">Keep {asset.name} in view.</h2>
    <p id="install-description">Give the market a little space on your screen.</p>
    {!desktopApp && download && <>
      <a className="install-primary" href={`${DOWNLOAD_SITE}?platform=${platform}#${asset.slug}`} target="_blank" rel="noreferrer"><InstallIcon /><span>Download for {download.name}</span></a>
      <p className="install-note">Choose the {asset.name} edition for your computer.<span>Available versions and installation details are on the download page.</span></p>
    </>}
    {!desktopApp && !download && prompt && <button type="button" className="install-primary" onClick={() => void installApp()}><InstallIcon /><span>{platform === 'android' ? 'Install for Android' : 'Install on this device'}</span></button>}
    {!desktopApp && !download && !prompt && canShare && <>
      <button type="button" className="install-primary" onClick={() => void shareApp()}><InstallIcon share /><span>Add to Home Screen</span></button>
      <p className="install-note">Choose <strong>Add to Home Screen</strong> in the share sheet.</p>
    </>}
    {!desktopApp && !download && !prompt && !canShare && <p className="install-guide">
      {platform === 'ios' ? <>In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</> : platform === 'android' ? <>Open the browser menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</> : <>Use your browser’s install menu to add Bloxwap to this device.</>}
    </p>}
    {settings && <div className="desktop-settings">
      <label><span>Start when my computer is idle</span><input type="checkbox" checked={settings.idleEnabled} onChange={(e) => void updateSettings({ ...settings, idleEnabled: e.target.checked })} /></label>
      <label><span>Wait before starting</span><select value={settings.idleMinutes} onChange={(e) => void updateSettings({ ...settings, idleMinutes: Number(e.target.value) })}>{[1, 2, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
      <p>The app stays in your menu bar or system tray. Move your mouse or press a key to return. Your computer’s sleep and lock settings still apply.</p>
    </div>}
    {error && <p className="install-error" role="status">{error}</p>}
  </dialog>;
}
