import { useEffect, useRef, useState } from 'react';

export type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallDialog({ onClose, prompt, onPromptUsed }: { onClose: () => void; prompt: InstallPrompt | null; onPromptUsed: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<{ idleEnabled: boolean; idleMinutes: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    ref.current?.showModal();
    if (window.screensaver) void window.screensaver.getSettings().then(setSettings).catch(() => setError('Could not load desktop preferences.'));
  }, []);

  async function updateSettings(next: { idleEnabled: boolean; idleMinutes: number }) {
    try { setSettings(await window.screensaver!.setSettings(next)); }
    catch { setError('Could not save desktop preferences.'); }
  }

  return <dialog ref={ref} className="install-dialog" aria-labelledby="install-title" onCancel={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
    <div className="dialog-top"><span className="eyebrow">Bloxwap screensaver</span><button className="icon-button" onClick={onClose} aria-label="Close installation instructions">×</button></div>
    <h2 id="install-title">Keep Bitcoin in view.</h2>
    <p>Give the market a little space on your screen.</p>
    {prompt && <button className="install-primary" onClick={async () => {
      try { await prompt.prompt(); await prompt.userChoice; onPromptUsed(); } catch { setError('Use your browser’s install menu to add the app.'); }
    }}>Install on this device <span>↗</span></button>}
    {settings && <div className="desktop-settings">
      <label><span>Start when my computer is idle</span><input type="checkbox" checked={settings.idleEnabled} onChange={(e) => void updateSettings({ ...settings, idleEnabled: e.target.checked })} /></label>
      <label><span>Wait before starting</span><select value={settings.idleMinutes} onChange={(e) => void updateSettings({ ...settings, idleMinutes: Number(e.target.value) })}>{[1, 2, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
      <p>The app stays in your menu bar or system tray. Move your mouse or press a key to return. Your computer’s sleep and lock settings still apply.</p>
    </div>}
    <div className="install-options">
      <div><h3>iPhone & iPad</h3><p>Open in Safari. Tap Share, then Add to Home Screen and enable Open as Web App.</p></div>
      <div><h3>Android</h3><p>Open in Chrome. Use the browser menu’s Install app or Add to Home screen option.</p></div>
      <div><h3>Mac, Windows & Linux</h3><p>Install from a supported browser’s menu, or use a desktop build for automatic idle activation.</p><a href="https://github.com/bloxwap/screensaver#desktop" target="_blank" rel="noreferrer">Desktop setup ↗</a></div>
    </div>
    <p className="install-note">On mobile, open the app to start. “Keep awake” keeps the display on while the app is visible, where supported.</p>
    {error && <p role="status">{error}</p>}
  </dialog>;
}
